"""The live outage risk index: today's storm hazards on the H3 grid, weighted by what's on the
ground and by how often the county has lost power before.

    python -m stormx_etl.risk OUT_DIR DATA

DATA is the data Worker's URL, or a local folder of ETL output; this reads its
risk/exposure-res6.json and history/outages/counties.geojson. Writes, under OUT_DIR/risk/:
    h3-res6.json       every cell with a risk of 5 or more, compact rows for the hex layer
    counties.geojson   each county's worst cell, for the county layer and its popups
    summary.json       sources, totals and the ten counties most at risk

Each term runs from 0 to 1:
    hazard         the worst forecast or warning over the cell (SPC, NHC, WPC, NWS), scaled to how
                   likely it is to break the grid
    exposure       transmission line length, substations and customers, each log-scaled to its
                   95th percentile
    vulnerability  the county's rank for yearly outage hours (EAGLE-I), and distance to a substation
    risk = 100 × hazard × (0.5 + 0.3 × exposure + 0.2 × vulnerability)
The plan's 50/30/20 weights stay, but hazard multiplies the rest, so a dense grid under clear skies
scores zero instead of 50.
"""

from __future__ import annotations

import math
import sys
import urllib.parse
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import h3

from .common import feature_collection, load_json, write_json
from .exposure import RES

MIN_RISK = 5
LEVELS = [(70, "Extreme"), (50, "Very high"), (30, "High"), (15, "Elevated"), (0, "Low")]

SPC = "https://www.spc.noaa.gov/products/outlook/day1otlk_{kind}.nolyr.geojson"
NHC = "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer/{layer}/query"
WSSI = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer/{layer}/query"
WWA = "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/FeatureServer/1/query"

CATEGORICAL = {
    "TSTM": (0.1, "SPC: general thunderstorms"),
    "MRGL": (0.25, "SPC: marginal severe risk"),
    "SLGT": (0.4, "SPC: slight severe risk"),
    "ENH": (0.55, "SPC: enhanced severe risk"),
    "MDT": (0.75, "SPC: moderate severe risk"),
    "HIGH": (0.9, "SPC: high severe risk"),
}
# Probability of the hazard within 25 miles, to a score. Wind and tornadoes take lines down; hail
# rarely does.
WIND = {0.05: 0.3, 0.15: 0.5, 0.30: 0.7, 0.45: 0.85, 0.60: 0.95}
TORNADO = {0.02: 0.25, 0.05: 0.4, 0.10: 0.6, 0.15: 0.75, 0.30: 0.9, 0.45: 0.95, 0.60: 1.0}
HAIL = {0.05: 0.15, 0.15: 0.25, 0.30: 0.35, 0.45: 0.45, 0.60: 0.5}
# SPC's significant-severe and conditional-intensity areas add to the probability inside them.
INTENSITY = {"SIGN": 0.1, "CIG1": 0.1, "CIG2": 0.2, "CIG3": 0.3}
TROPICAL = {7: (0.5, "34 kt"), 8: (0.75, "50 kt"), 9: (1.0, "64 kt")}
ICE = {"WINTER WEATHER AREA": 0.15, "MINOR": 0.4, "MODERATE": 0.6, "MAJOR": 0.8, "EXTREME": 1.0}
SNOW_LOAD = {"WINTER WEATHER AREA": 0.1, "MINOR": 0.25, "MODERATE": 0.45, "MAJOR": 0.65, "EXTREME": 0.85}
ALERTS = {
    "Extreme Wind Warning": 1.0,
    "Hurricane Warning": 0.95,
    "Tornado Warning": 0.9,
    "Ice Storm Warning": 0.85,
    "Storm Surge Warning": 0.7,
    "Blizzard Warning": 0.7,
    "Typhoon Warning": 0.95,
    "Severe Thunderstorm Warning": 0.6,
    "High Wind Warning": 0.6,
    "Tropical Storm Warning": 0.6,
    "Hurricane Watch": 0.5,
    "Winter Storm Warning": 0.35,
    "Storm Surge Watch": 0.4,
    "Tornado Watch": 0.4,
    "Red Flag Warning": 0.35,
    "Extreme Heat Warning": 0.35,
    "Excessive Heat Warning": 0.35,
    "Flash Flood Warning": 0.35,
    "Wind Advisory": 0.3,
    "Extreme Cold Warning": 0.3,
    "Severe Thunderstorm Watch": 0.3,
    "High Wind Watch": 0.3,
    "Tropical Storm Watch": 0.3,
    "Winter Storm Watch": 0.2,
    "Flood Warning": 0.2,
}

Scores = dict[str, tuple[float, str]]


@dataclass
class Source:
    name: str
    urls: list[str]
    # Feature properties to (score, label), or None to skip the feature.
    score: Callable[[dict[str, Any]], tuple[float, str] | None]
    # Probability areas whose intensity overlays add to the score instead of competing with it.
    intensity: bool = False


def query_url(base: str, where: str = "1=1", fields: str = "*") -> str:
    query = {"where": where, "outFields": fields, "outSR": 4326, "maxAllowableOffset": 0.01, "geometryPrecision": 3, "f": "geojson"}
    return f"{base}?{urllib.parse.urlencode(query)}"


def probability(table: dict[float, float], name: str) -> Callable[[dict[str, Any]], tuple[float, str] | None]:
    def score(props: dict[str, Any]) -> tuple[float, str] | None:
        try:
            p = float(props.get("LABEL", ""))
        except ValueError:
            return None
        best = max((s for threshold, s in table.items() if p >= threshold - 1e-9), default=0.0)
        return (best, f"SPC: {round(p * 100)}% chance of {name}") if best else None

    return score


def categorical(props: dict[str, Any]) -> tuple[float, str] | None:
    return CATEGORICAL.get(props.get("LABEL", ""))


def tropical(layer: int) -> Callable[[dict[str, Any]], tuple[float, str] | None]:
    weight, speed = TROPICAL[layer]

    def score(props: dict[str, Any]) -> tuple[float, str] | None:
        p = props.get("PWIND120") or 0
        return (weight * p / 100, f"NHC: {round(p)}% chance of {speed} winds in 5 days") if p else None

    return score


def winter(table: dict[str, float], name: str) -> Callable[[dict[str, Any]], tuple[float, str] | None]:
    def score(props: dict[str, Any]) -> tuple[float, str] | None:
        impact = str(props.get("impact", "")).upper()
        if impact not in table:
            return None
        label = "winter weather" if impact == "WINTER WEATHER AREA" else f"{impact.lower()} {name} impacts"
        return table[impact], f"WPC: {label}, days 1 to 3"

    return score


def alert(props: dict[str, Any]) -> tuple[float, str] | None:
    kind = props.get("prod_type", "")
    return (ALERTS[kind], f"NWS: {kind}") if kind in ALERTS else None


def sources() -> list[Source]:
    listed = ", ".join(f"'{k}'" for k in ALERTS)
    return [
        Source("SPC outlook", [SPC.format(kind="cat")], categorical),
        Source("SPC wind", [SPC.format(kind="wind")], probability(WIND, "damaging wind"), intensity=True),
        Source("SPC tornado", [SPC.format(kind="torn")], probability(TORNADO, "a tornado"), intensity=True),
        Source("SPC hail", [SPC.format(kind="hail")], probability(HAIL, "large hail"), intensity=True),
        *(Source(f"NHC {TROPICAL[layer][1]} winds", [query_url(NHC.format(layer=layer))], tropical(layer)) for layer in TROPICAL),
        Source("WPC ice", [query_url(WSSI.format(layer=19), fields="impact")], winter(ICE, "ice")),
        Source("WPC snow load", [query_url(WSSI.format(layer=14), fields="impact")], winter(SNOW_LOAD, "snow load")),
        Source("NWS alerts", [query_url(WWA, where=f"prod_type IN ({listed})", fields="prod_type")], alert),
    ]


def polygon_cells(geometry: dict[str, Any] | None, res: int = RES) -> set[str]:
    if not geometry or geometry.get("type") not in ("Polygon", "MultiPolygon"):
        return set()
    rings = geometry["coordinates"] if geometry["type"] == "Polygon" else [r for p in geometry["coordinates"] for r in p]
    lons = [pt[0] for ring in rings for pt in ring]
    # A shape across the antimeridian (western Alaska) would fill the globe the wrong way round.
    if not lons or max(lons) - min(lons) > 180:
        return set()
    try:
        # Overlap, not center containment, so thin warning polygons still reach a cell.
        return set(h3.h3shape_to_cells_experimental(h3.geo_to_h3shape(geometry), res, contain="overlap"))
    except (ValueError, h3.H3BaseException):
        return set()  # A broken ring in one polygon shouldn't drop the whole feed.


def source_scores(source: Source, collections: list[dict[str, Any]]) -> Scores:
    """The best score per cell for one source."""
    best: Scores = {}
    bonus: dict[str, float] = defaultdict(float)
    for collection in collections:
        for feature in collection.get("features") or []:
            props = feature.get("properties") or {}
            if source.intensity and props.get("LABEL") in INTENSITY:
                for cell in polygon_cells(feature.get("geometry")):
                    bonus[cell] = max(bonus[cell], INTENSITY[props["LABEL"]])
                continue
            scored = source.score(props)
            if not scored:
                continue
            for cell in polygon_cells(feature.get("geometry")):
                if cell not in best or scored[0] > best[cell][0]:
                    best[cell] = scored
    for cell, extra in bonus.items():
        if cell in best:
            score, label = best[cell]
            best[cell] = (min(1.0, score + extra), f"{label}, significant")
    return best


def combine(per_source: list[Scores]) -> Scores:
    """The worst hazard per cell, with what caused it."""
    out: Scores = {}
    for scores in per_source:
        for cell, scored in scores.items():
            if cell not in out or scored[0] > out[cell][0]:
                out[cell] = scored
    return out


def log_scale(value: float, p95: float) -> float:
    return min(1.0, math.log1p(value) / math.log1p(p95)) if value > 0 and p95 > 0 else 0.0


def exposure_score(line_km: float, substations: int, customers: float, p95: dict[str, float]) -> float:
    return (
        0.4 * log_scale(line_km, p95["line_km"])
        + 0.3 * log_scale(substations, p95["substations"])
        + 0.3 * log_scale(customers, p95["customers"])
    )


def county_ranks(counties: list[dict[str, Any]]) -> dict[str, float]:
    """Each county's percentile rank (0 to 1) for yearly outage hours per customer."""
    hours = sorted((f["properties"].get("hours_per_customer"), f["properties"]["fips"]) for f in counties if f["properties"].get("hours_per_customer") is not None)
    n = len(hours)
    return {fips: (i + 0.5) / n for i, (_, fips) in enumerate(hours)} if n else {}


def risk_score(hazard: float, exposure: float, vulnerability: float) -> int:
    return round(100 * hazard * (0.5 + 0.3 * exposure + 0.2 * vulnerability))


def level(risk: int) -> str:
    return next(name for floor, name in LEVELS if risk >= floor)


def customers_affected(customers: float, risk: int) -> int:
    """A rough guess at customers who lose power: 10% at a risk of 50, 26% at 80."""
    return round(customers * 0.4 * (risk / 100) ** 2)


CELL_COLUMNS = ["cell", "risk", "hazard", "driver", "exposure", "vulnerability", "line_km", "substations", "customers", "customers_affected", "fips"]


def score_cells(hazards: Scores, exposure: dict[str, Any], ranks: dict[str, float]) -> tuple[list[list[Any]], list[str]]:
    """Rows in CELL_COLUMNS order, worst first, and the driver labels their driver column indexes."""
    columns = exposure["meta"]["columns"]
    at = {name: columns.index(name) for name in columns}
    p95 = exposure["meta"]["p95"]
    drivers: dict[str, int] = {}
    rows = []
    for cell, (hazard, driver) in hazards.items():
        row = exposure["cells"].get(cell)
        if not row:
            continue  # Outside the U.S.
        line_km, subs, customers, fips = row[at["line_km"]], row[at["substations"]], row[at["customers"]], row[at["fips"]]
        e = exposure_score(line_km, subs, customers, p95)
        v = 0.7 * ranks.get(fips, 0.5) + 0.3 * row[at["far_from_substation"]]
        risk = risk_score(hazard, e, v)
        if risk < MIN_RISK:
            continue
        index = drivers.setdefault(driver, len(drivers))
        rows.append([cell, risk, round(hazard, 2), index, round(e, 2), round(v, 2), line_km, subs, customers, customers_affected(customers, risk), fips])
    rows.sort(key=lambda r: -r[1])
    return rows, list(drivers)


def county_rollup(rows: list[list[Any]], drivers: list[str], counties: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each county's worst cell, total customers affected and the cells at Elevated or above."""
    worst: dict[str, list[Any]] = {}
    affected: Counter[str] = Counter()
    elevated: Counter[str] = Counter()
    for row in rows:
        fips = row[10]
        if fips not in worst or row[1] > worst[fips][1]:
            worst[fips] = row
        affected[fips] += row[9]
        if row[1] >= 15:
            elevated[fips] += 1
    features = []
    for county in counties:
        props = county["properties"]
        row = worst.get(props["fips"])
        if not row:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": county["geometry"],
                "properties": {
                    "fips": props["fips"],
                    "name": props["name"],
                    "state": props["state"],
                    "risk": row[1],
                    "level": level(row[1]),
                    "driver": drivers[row[3]],
                    "customers": props.get("customers"),
                    "customers_affected": affected[props["fips"]],
                    "elevated_cells": elevated[props["fips"]],
                    "hours_per_customer": props.get("hours_per_customer"),
                },
            }
        )
    features.sort(key=lambda f: (-f["properties"]["risk"], -f["properties"]["customers_affected"]))
    return features


def fetch_source(source: Source) -> list[dict[str, Any]]:
    return [load_json(url, timeout=90) for url in source.urls]


def main(out_dir: str, data: str, fetcher: Callable[[Source], list[dict[str, Any]]] = fetch_source) -> None:
    data = data.rstrip("/")
    exposure = load_json(f"{data}/risk/exposure-res6.json", timeout=300)
    counties = load_json(f"{data}/history/outages/counties.geojson")["features"]

    status: dict[str, Any] = {}
    per_source = []
    for source in sources():
        try:
            scores = source_scores(source, fetcher(source))
        except Exception as err:  # noqa: BLE001 - one feed down shouldn't blank the map.
            print(f"{source.name}: {err}")
            status[source.name] = {"ok": False, "error": str(err)[:200]}
            continue
        status[source.name] = {"ok": True, "cells": len(scores)}
        per_source.append(scores)
    if not per_source:
        raise RuntimeError("Every hazard feed failed; keeping the last risk files")

    rows, drivers = score_cells(combine(per_source), exposure, county_ranks(counties))
    rollup = county_rollup(rows, drivers, counties)
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = Path(out_dir) / "risk"
    meta = {"updated": now, "res": RES, "exposure_updated": exposure["meta"]["updated"]}
    write_json(out / "h3-res6.json", {"meta": meta | {"columns": CELL_COLUMNS, "drivers": drivers}, "cells": rows})
    write_json(out / "counties.geojson", feature_collection(rollup, **meta))
    levels = Counter(level(r[1]) for r in rows)
    county_levels = Counter(f["properties"]["level"] for f in rollup)
    summary = {
        **meta,
        "sources": status,
        "cells": {name: levels.get(name, 0) for _, name in LEVELS},
        "customers_affected": sum(r[9] for r in rows),
        "counties": {name: county_levels.get(name, 0) for _, name in LEVELS},
        "top": [{k: f["properties"][k] for k in ("fips", "name", "state", "risk", "level", "driver", "customers_affected")} for f in rollup[:10]],
    }
    write_json(out / "summary.json", summary)
    print(f"Risk: {len(rows)} cells, {len(rollup)} counties, {summary['customers_affected']} customers affected; {summary['counties']}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python -m stormx_etl.risk OUT_DIR DATA")
    main(sys.argv[1], sys.argv[2])
