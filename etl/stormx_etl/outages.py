"""Current power outages by county from ORNL ODIN (Outage Data Initiative Nationwide).

ODIN's public map endpoints send no CORS header, so this job copies them to R2 every 15 minutes.
Coverage is only the utilities that report to ODIN, not the whole country.

    python -m stormx_etl.outages OUT_DIR

Writes OUT_DIR/live/outages/odin-county.geojson, and summary.json beside it for the mode card.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .common import feature_collection, fetch, write_json

STATUS_URL = "https://odin.ornl.gov/odi/status"
COUNTY_URL = "https://odin.ornl.gov/odi/map?scale=COUNTY"


def _round(coords: Any) -> Any:
    """Rounds nested coordinate arrays to 5 decimals (about 1 m), which halves the file."""
    if coords and isinstance(coords[0], (int, float)):
        return [round(c, 5) for c in coords]
    return [_round(c) for c in coords]


def parse_counties(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """ODIN county records to GeoJSON polygons with customers out and the reporting utilities.

    ODIN's metersServed is the utility's own total in some feeds and zero in others, so it isn't
    used; percent out waits for EAGLE-I's modeled customers per county.
    """
    features = []
    for record in records:
        geometry = record.get("feature") or {}
        if geometry.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        outages = record.get("outages") or []
        out = sum(int(o.get("metersOut") or 0) for o in outages) or int(record.get("metersOut") or 0)
        if out <= 0:
            continue
        utilities = sorted({o["utilityName"].strip() for o in outages if o.get("utilityName")})
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": geometry["type"], "coordinates": _round(geometry["coordinates"])},
                "properties": {
                    "fips": str(record.get("id", "")).zfill(5),
                    "county": record.get("countyName") or "",
                    "state": record.get("stateName") or "",
                    "customers_out": out,
                    "utilities": "; ".join(utilities),
                },
            }
        )
    features.sort(key=lambda f: -f["properties"]["customers_out"])
    return features


def summarize_status(status: list[dict[str, Any]]) -> dict[str, Any]:
    """How many utilities report to ODIN and how many answered without an error."""
    reporting = [u for u in status if not u.get("hasError")]
    latest = max((u["receivedDate"] for u in reporting if u.get("receivedDate")), default=None)
    return {"utilities": len(status), "utilities_ok": len(reporting), "latest_report": latest}


def main(out_dir: str) -> None:
    out = Path(out_dir)
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    records = json.loads(fetch(COUNTY_URL, timeout=90))
    status = json.loads(fetch(STATUS_URL))
    if not isinstance(records, list) or not isinstance(status, list):
        raise RuntimeError("ODIN answered with something other than a list")
    counties = parse_counties(records)
    meta = summarize_status(status) | {
        "updated": now,
        "source": "ORNL ODIN",
        "counties": len(counties),
        "customers_out": sum(f["properties"]["customers_out"] for f in counties),
    }
    write_json(out / "live/outages/odin-county.geojson", feature_collection(counties, **meta))
    write_json(out / "live/outages/summary.json", meta)
    print(f"ODIN: {meta['customers_out']} customers out in {len(counties)} counties, {meta['utilities_ok']}/{meta['utilities']} utilities reporting")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
