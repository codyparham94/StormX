"""A snapshot of the HIFLD substations on R2.

The map reads the substations live from a community re-upload of HIFLD's last public release. That
copy is one person's item and could disappear, so this keeps a copy the site falls back to.

    python -m stormx_etl.grid OUT_DIR

Writes OUT_DIR/grid/substations.geojson.
"""

from __future__ import annotations

import json
import sys
import urllib.parse
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .common import feature_collection, fetch, write_json

SUBSTATIONS_URL = "https://services6.arcgis.com/OO2s4OoyCZkYJ6oE/arcgis/rest/services/Substations/FeatureServer/0"
FIELDS = ("NAME", "CITY", "STATE", "COUNTY", "STATUS", "LINES", "MAX_VOLT", "MIN_VOLT")
PAGE = 2000
EXPECTED = 70_000


def page_url(offset: int) -> str:
    query = {
        "where": "1=1",
        "outFields": ",".join(FIELDS),
        "orderByFields": "OBJECTID",
        "resultOffset": offset,
        "resultRecordCount": PAGE,
        "outSR": 4326,
        "f": "geojson",
    }
    return f"{SUBSTATIONS_URL}/query?{urllib.parse.urlencode(query)}"


def slim(feature: dict[str, Any]) -> dict[str, Any] | None:
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Point":
        return None
    lon, lat = geometry["coordinates"][:2]
    props = feature.get("properties") or {}
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        # HIFLD marks unknown numbers as -999999.
        "properties": {k: (None if props.get(k) == -999999 else props.get(k)) for k in FIELDS},
    }


def fetch_substations() -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = json.loads(fetch(page_url(offset), timeout=120)).get("features") or []
        features.extend(f for f in map(slim, page) if f)
        if len(page) < PAGE:
            return features
        offset += PAGE


def main(out_dir: str) -> None:
    features = fetch_substations()
    if len(features) < EXPECTED:
        raise RuntimeError(f"Only {len(features)} substations came back; keeping the old snapshot")
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_json(Path(out_dir) / "grid/substations.geojson", feature_collection(features, updated=now, source="HIFLD (community copy)"))
    print(f"Substations: {len(features)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
