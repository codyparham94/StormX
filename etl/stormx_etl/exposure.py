"""What's on the ground in each H3 cell, for the risk index: transmission line length and voltage,
substations, and an estimate of utility customers.

    python -m stormx_etl.exposure OUT_DIR DATA

DATA is the data Worker's URL, or a local folder of ETL output; the county shapes and customer
counts come from its history/outages/counties.geojson, so they match the outage history. Writes
OUT_DIR/risk/exposure-res6.json. It changes slowly, so it runs monthly; the risk job reads it back
every hour.

Customers are spread evenly over each county's cells. That flattens cities into their counties; it
is the v1 shortcut until tract households replace it.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.parse
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import h3

from .common import fetch, load_json, write_json
from .grid import fetch_substations

RES = 6
LINES_URL = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0"
PAGE = 2000
LINES_EXPECTED = 90_000
SAMPLE_KM = 1.0
EARTH_KM = 6371.0088
COLUMNS = ["line_km", "substations", "max_kv", "customers", "fips", "far_from_substation"]


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance between two (lon, lat) points."""
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


def line_km_by_cell(coords: list[list[float]], res: int = RES) -> dict[str, float]:
    """Splits a polyline into ~1 km pieces and credits each piece's length to the cell it falls in."""
    out: dict[str, float] = defaultdict(float)
    for a, b in zip(coords, coords[1:], strict=False):
        length = haversine_km((a[0], a[1]), (b[0], b[1]))
        if length == 0:
            continue
        pieces = max(1, math.ceil(length / SAMPLE_KM))
        for i in range(pieces):
            t = (i + 0.5) / pieces
            lon, lat = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            out[h3.latlng_to_cell(lat, lon, res)] += length / pieces
    return out


def lines_page_url(offset: int) -> str:
    query = {
        "where": "1=1",
        "outFields": "VOLTAGE",
        "orderByFields": "OBJECTID",
        "resultOffset": offset,
        "resultRecordCount": PAGE,
        "outSR": 4326,
        # About 200 m: plenty for 1 km pieces, and a quarter of the download.
        "maxAllowableOffset": 0.002,
        "geometryPrecision": 4,
        "f": "geojson",
    }
    return f"{LINES_URL}/query?{urllib.parse.urlencode(query)}"


def add_lines(cells: dict[str, list[Any]], features: list[dict[str, Any]]) -> None:
    for feature in features:
        geometry = feature.get("geometry") or {}
        parts = {"LineString": [geometry.get("coordinates")], "MultiLineString": geometry.get("coordinates")}.get(geometry.get("type"), [])
        voltage = (feature.get("properties") or {}).get("VOLTAGE") or 0
        # HIFLD marks unknown voltages as -999999.
        voltage = voltage if 0 < voltage < 2000 else 0
        for part in parts or []:
            for cell, km in line_km_by_cell(part).items():
                row = cells[cell]
                row[0] += km
                row[2] = max(row[2], voltage)


def fetch_lines(cells: dict[str, list[Any]]) -> int:
    offset = 0
    while True:
        for attempt in range(3):
            page = json.loads(fetch(lines_page_url(offset), timeout=180))
            # ArcGIS answers some overloaded requests with a 200 and an error body.
            if "error" not in page:
                break
            if attempt == 2:
                raise RuntimeError(f"Transmission lines at offset {offset}: {page['error']}")
        features = page.get("features") or []
        add_lines(cells, features)
        offset += len(features)
        if not features or not (page.get("properties") or {}).get("exceededTransferLimit"):
            return offset


def percentile(values: list[float], q: float) -> float:
    """The q quantile of the positive values, so empty cells don't drag the scale to zero."""
    ordered = sorted(v for v in values if v > 0)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))] if ordered else 1.0


def county_cells(geometry: dict[str, Any], res: int = RES) -> set[str]:
    cells = set(h3.geo_to_cells(geometry, res))
    if not cells:
        # Smaller than a cell: use the cell under its first vertex.
        ring = geometry["coordinates"][0] if geometry["type"] == "Polygon" else geometry["coordinates"][0][0]
        cells = {h3.latlng_to_cell(ring[0][1], ring[0][0], res)}
    return cells


def main(out_dir: str, data: str) -> None:
    # cell -> [line km, substations, max kV, customers, county FIPS]
    cells: dict[str, list[Any]] = defaultdict(lambda: [0.0, 0, 0, 0.0, ""])

    counties = load_json(f"{data.rstrip('/')}/history/outages/counties.geojson")["features"]
    for county in counties:
        props = county["properties"]
        inside = county_cells(county["geometry"])
        share = (props.get("customers") or 0) / len(inside)
        for cell in inside:
            cells[cell][3] += share
            cells[cell][4] = props["fips"]

    lines = fetch_lines(cells)
    if lines < LINES_EXPECTED:
        raise RuntimeError(f"Only {lines} transmission lines came back; keeping the old exposure file")
    substations = fetch_substations()
    for sub in substations:
        lon, lat = sub["geometry"]["coordinates"]
        row = cells[h3.latlng_to_cell(lat, lon, RES)]
        row[1] += 1
        row[2] = max(row[2], sub["properties"].get("MAX_VOLT") or 0)

    # A cell more than two rings (about 15 km) from any substation waits longer for restoration.
    near: set[str] = set()
    for cell, row in cells.items():
        if row[1]:
            near.update(h3.grid_disk(cell, 2))

    rows = {
        cell: [round(km, 1), subs, int(kv), round(cust), fips, 0 if cell in near else 1]
        for cell, (km, subs, kv, cust, fips) in cells.items()
        if fips  # Only cells inside a U.S. county.
    }
    meta = {
        "updated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "res": RES,
        "columns": COLUMNS,
        # The risk job scales each term against its 95th percentile.
        "p95": {
            "line_km": percentile([r[0] for r in rows.values()], 0.95),
            "substations": percentile([r[1] for r in rows.values()], 0.95),
            "customers": percentile([r[3] for r in rows.values()], 0.95),
        },
        "sources": "HIFLD transmission lines (USFWS copy) and substations; ORNL EAGLE-I customers; Census counties",
    }
    write_json(Path(out_dir) / "risk/exposure-res6.json", {"meta": meta, "cells": rows})
    print(f"Exposure: {len(rows)} cells, {lines} lines, {len(substations)} substations, p95 {meta['p95']}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python -m stormx_etl.exposure OUT_DIR DATA")
    main(sys.argv[1], sys.argv[2])
