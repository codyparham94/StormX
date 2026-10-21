"""StormX Demo Electric: a fictional Gulf Coast utility for the utility operations demo. Everything
here is made up and is labeled Simulated wherever it shows.

    python -m stormx_etl.sim OUT_DIR DATA

The network (substations, feeders, customers) comes from a fixed seed, so it is the same every run.
Outage tickets are new each hour: each feeder's chance of trouble follows the live risk index over
it (OUT_DIR/risk/h3-res6.json, written by the risk job just before), on top of everyday causes.
Open tickets carry over from the last run (DATA/sim/tickets.geojson) until they're restored.

Writes, under OUT_DIR/sim/: territory.geojson, substations.geojson, feeders.geojson,
tickets.geojson and summary.json.
"""

from __future__ import annotations

import json
import math
import random
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import h3

from .common import feature_collection, load_json, write_json
from .exposure import RES, haversine_km

UTILITY = "StormX Demo Electric"
NOTE = "Simulated data. StormX Demo Electric is a fictional utility made up for this demo."
SEED = 2026
# East of Baton Rouge, in the demo region the outage map opens on.
CENTER = (-90.95, 30.45)
SUBSTATIONS = [
    ("Cypress Bend", -0.22, 0.10),
    ("Magnolia", 0.05, 0.14),
    ("Pelican Point", 0.25, 0.05),
    ("Live Oak", -0.12, -0.10),
    ("Bayou Lane", 0.15, -0.12),
]
STEP_KM = 0.5
KEEP_HOURS = 8
CAUSES = {
    "wind": [("Tree on line", 5), ("Line down", 3), ("Broken pole", 2), ("Blown fuse", 2)],
    "winter": [("Ice on lines", 5), ("Tree on line", 4), ("Line down", 2)],
    "everyday": [("Equipment failure", 4), ("Animal contact", 3), ("Tree contact", 3), ("Vehicle hit pole", 1), ("Lightning", 1)],
}


def walk(rng: random.Random, start: tuple[float, float], heading: float, steps: int) -> list[list[float]]:
    """A wandering line from start, STEP_KM at a time."""
    lon, lat = start
    points = [[round(lon, 5), round(lat, 5)]]
    for _ in range(steps):
        heading += rng.gauss(0, 0.15)
        lat += STEP_KM / 111.0 * math.sin(heading)
        lon += STEP_KM / (111.0 * math.cos(math.radians(lat))) * math.cos(heading)
        points.append([round(lon, 5), round(lat, 5)])
    return points


def length_km(parts: list[list[list[float]]]) -> float:
    return sum(haversine_km((a[0], a[1]), (b[0], b[1])) for part in parts for a, b in zip(part, part[1:], strict=False))


def build_network(seed: int = SEED) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(substations, feeders) as GeoJSON features."""
    rng = random.Random(seed)
    substations, feeders = [], []
    for s, (name, dx, dy) in enumerate(SUBSTATIONS, start=1):
        origin = (CENTER[0] + dx + rng.uniform(-0.02, 0.02), CENTER[1] + dy + rng.uniform(-0.02, 0.02))
        count = rng.randint(5, 7)
        names = []
        for f in range(1, count + 1):
            heading = 2 * math.pi * f / count + rng.uniform(-0.3, 0.3)
            trunk = walk(rng, origin, heading, rng.randint(12, 26))
            parts = [trunk]
            for _ in range(rng.randint(2, 4)):
                at = rng.randint(3, len(trunk) - 2)
                side = rng.choice((-1, 1)) * math.pi / 2 + rng.uniform(-0.4, 0.4)
                parts.append(walk(rng, (trunk[at][0], trunk[at][1]), heading + side, rng.randint(3, 8)))
            km = length_km(parts)
            feeder = f"{s}{f:02d}"
            names.append(feeder)
            feeders.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "MultiLineString", "coordinates": parts},
                    "properties": {"feeder": feeder, "substation": name, "km": round(km, 1), "customers": round(km * rng.uniform(70, 160))},
                }
            )
        substations.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(origin[0], 5), round(origin[1], 5)]},
                "properties": {"name": name, "feeders": len(names), "feeder_ids": ", ".join(names)},
            }
        )
    return substations, feeders


def convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Andrew's monotone chain, counterclockwise."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    upper: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def territory(feeders: list[dict[str, Any]]) -> dict[str, Any]:
    hull = convex_hull([(p[0], p[1]) for f in feeders for part in f["geometry"]["coordinates"] for p in part])
    cx, cy = sum(p[0] for p in hull) / len(hull), sum(p[1] for p in hull) / len(hull)
    # A little room around the outermost lines.
    ring = [[round(cx + (x - cx) * 1.06, 4), round(cy + (y - cy) * 1.06, 4)] for x, y in hull]
    ring.append(ring[0])
    customers = sum(f["properties"]["customers"] for f in feeders)
    return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {"utility": UTILITY, "customers": customers, "feeders": len(feeders)}}


def feeder_risk(feeder: dict[str, Any], cells: dict[str, tuple[int, str]]) -> tuple[int, str]:
    """The worst live risk over any part of the feeder, and its hazard."""
    best = (0, "")
    for part in feeder["geometry"]["coordinates"]:
        for lon, lat in part:
            scored = cells.get(h3.latlng_to_cell(lat, lon, RES))
            if scored and scored[0] > best[0]:
                best = scored
    return best


def cause_kind(driver: str) -> str:
    text = driver.lower()
    if any(w in text for w in ("winter", "ice", "snow", "blizzard")):
        return "winter"
    return "wind" if driver else "everyday"


def pick(rng: random.Random, options: list[tuple[str, int]]) -> str:
    return rng.choices([name for name, _ in options], weights=[w for _, w in options])[0]


def new_tickets(feeder: dict[str, Any], risk: int, driver: str, now: datetime) -> list[dict[str, Any]]:
    """This hour's tickets on one feeder. Stable for a given feeder and hour."""
    props = feeder["properties"]
    rng = random.Random(f"{props['feeder']}:{now:%Y%m%d%H}")
    # About one ticket an hour across the system on a calm day.
    chance = 0.01 + 0.6 * (risk / 100) ** 2
    count = sum(1 for _ in range(3) if rng.random() < chance)
    tickets = []
    for n in range(count):
        part = rng.choice(feeder["geometry"]["coordinates"])
        lon, lat = rng.choice(part[1:])
        stormy = risk >= 15 and rng.random() < 0.8
        cause = pick(rng, CAUSES[cause_kind(driver) if stormy else "everyday"])
        lockout = rng.random() < 0.03 + 0.35 * risk / 100
        share = 1.0 if lockout else rng.uniform(0.01, 0.12 + 0.3 * risk / 100)
        # Bigger storms mean longer restorations.
        restore = rng.uniform(120, 480) if lockout else rng.uniform(60, 300)
        reported = now - timedelta(minutes=rng.uniform(0, 59))
        tickets.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "ticket": f"T{now:%m%d%H}-{props['feeder']}-{n + 1}",
                    "feeder": props["feeder"],
                    "substation": props["substation"],
                    "cause": cause,
                    "scope": "Feeder lockout" if lockout else "Lateral or transformer",
                    "customers_affected": max(1, round(props["customers"] * share)),
                    "reported": reported.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "restore_minutes": round(restore * (1 + risk / 50)),
                },
            }
        )
    return tickets


def ticket_status(props: dict[str, Any], now: datetime) -> tuple[str, int]:
    """(status, customers still out) for a ticket at `now`."""
    age = (now - datetime.fromisoformat(props["reported"].replace("Z", "+00:00"))).total_seconds() / 60
    if age >= props["restore_minutes"]:
        return "Restored", 0
    status = "Reported" if age < 20 else "Crew assigned" if age < 60 else "Crew on site"
    return status, props["customers_affected"]


def load_risk(path: Path) -> dict[str, tuple[int, str]]:
    try:
        file = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    columns, drivers = file["meta"]["columns"], file["meta"]["drivers"]
    cell, risk, driver = columns.index("cell"), columns.index("risk"), columns.index("driver")
    return {row[cell]: (row[risk], drivers[row[driver]]) for row in file["cells"]}


def previous_tickets(data: str) -> list[dict[str, Any]]:
    try:
        return load_json(f"{data.rstrip('/')}/sim/tickets.geojson", timeout=60)["features"]
    except Exception as err:  # noqa: BLE001 - the first run, or R2 is down: start fresh.
        print(f"No previous tickets ({err})")
        return []


def run(out_dir: str, data: str, now: datetime) -> dict[str, Any]:
    substations, feeders = build_network()
    cells = load_risk(Path(out_dir) / "risk/h3-res6.json")

    tickets = {}
    cutoff = now - timedelta(hours=KEEP_HOURS)
    for t in previous_tickets(data):
        if datetime.fromisoformat(t["properties"]["reported"].replace("Z", "+00:00")) >= cutoff:
            tickets[t["properties"]["ticket"]] = t
    for feeder in feeders:
        risk, driver = feeder_risk(feeder, cells)
        feeder["properties"] |= {"risk": risk, "hazard": driver or "None"}
        for t in new_tickets(feeder, risk, driver, now):
            tickets.setdefault(t["properties"]["ticket"], t)

    out_by_feeder: dict[str, int] = {}
    locked: set[str] = set()
    for t in tickets.values():
        props = t["properties"]
        status, out = ticket_status(props, now)
        props |= {"status": status, "customers_out": out}
        if out:
            out_by_feeder[props["feeder"]] = out_by_feeder.get(props["feeder"], 0) + out
            if props["scope"] == "Feeder lockout":
                locked.add(props["feeder"])
    for feeder in feeders:
        props = feeder["properties"]
        out = min(props["customers"], out_by_feeder.get(props["feeder"], 0))
        props |= {"customers_out": out, "status": "Locked out" if props["feeder"] in locked else "Partial outage" if out else "Normal"}

    ordered = sorted(tickets.values(), key=lambda t: t["properties"]["reported"], reverse=True)
    area = territory(feeders)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = {"updated": stamp, "simulated": True, "note": NOTE}
    out = Path(out_dir) / "sim"
    write_json(out / "territory.geojson", feature_collection([area], **meta))
    write_json(out / "substations.geojson", feature_collection(substations, **meta))
    write_json(out / "feeders.geojson", feature_collection(feeders, **meta))
    write_json(out / "tickets.geojson", feature_collection(ordered, **meta))
    summary = {
        **meta,
        "utility": UTILITY,
        "customers": area["properties"]["customers"],
        "customers_out": sum(f["properties"]["customers_out"] for f in feeders),
        "feeders": len(feeders),
        "feeders_out": sum(1 for f in feeders if f["properties"]["status"] != "Normal"),
        "tickets_open": sum(1 for t in ordered if t["properties"]["status"] != "Restored"),
        "tickets_restored": sum(1 for t in ordered if t["properties"]["status"] == "Restored"),
        "max_risk": max(f["properties"]["risk"] for f in feeders),
    }
    write_json(out / "summary.json", summary)
    return summary


def main(out_dir: str, data: str) -> None:
    summary = run(out_dir, data, datetime.now(UTC))
    print(f"Simulated utility: {summary['customers_out']} of {summary['customers']} out, {summary['tickets_open']} open tickets")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python -m stormx_etl.sim OUT_DIR DATA")
    main(sys.argv[1], sys.argv[2])
