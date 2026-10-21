"""Fire layers for Radar mode: NASA FIRMS hotspots and NOAA HMS smoke plumes.

FIRMS needs a MAP_KEY, so the browser never calls it; this job caches the last 24 hours over
CONUS as GeoJSON. HMS smoke polygons are a daily shapefile with no CORS, so they are converted too.

    python -m stormx_etl.fire OUT_DIR        (reads FIRMS_MAP_KEY from the environment)

Writes OUT_DIR/live/fire/firms.geojson and OUT_DIR/live/fire/smoke.geojson.
"""

from __future__ import annotations

import csv
import io
import os
import sys
import tempfile
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import shapefile

from .common import feature_collection, fetch, write_json

# CONUS plus a margin, as FIRMS wants it: west,south,east,north.
CONUS_BBOX = "-125.5,24,-66,49.5"
FIRMS_SOURCES = ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "MODIS_NRT")
# The day range counts UTC calendar days ending today, so 1 would be empty just after midnight UTC.
# Ask for 2 and keep the last 24 hours.
FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{bbox}/2"
HMS_URL = "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/Shapefile/{y}/{m:02d}/hms_smoke{y}{m:02d}{d:02d}.zip"

# VIIRS reports confidence as l/n/h, MODIS as 0-100.
VIIRS_CONFIDENCE = {"l": "low", "n": "nominal", "h": "high"}


def modis_confidence(value: str) -> str:
    try:
        number = int(value)
    except ValueError:
        return "unknown"
    return "low" if number < 30 else "nominal" if number < 80 else "high"


def parse_firms(text: str, source: str) -> list[dict[str, Any]]:
    """One FIRMS area CSV to GeoJSON point features."""
    features = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            lat, lon = float(row["latitude"]), float(row["longitude"])
        except (KeyError, ValueError):
            continue
        hhmm = row.get("acq_time", "0").zfill(4)
        when = f"{row.get('acq_date', '')}T{hhmm[:2]}:{hhmm[2:]}:00Z"
        raw_conf = row.get("confidence", "")
        confidence = VIIRS_CONFIDENCE.get(raw_conf) if source.startswith("VIIRS") else modis_confidence(raw_conf)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]},
                "properties": {
                    "source": source.replace("_NRT", "").replace("_", " "),
                    "acquired": when,
                    "confidence": confidence or "unknown",
                    "frp": float(row["frp"]) if row.get("frp") else None,
                    "daynight": "day" if row.get("daynight") == "D" else "night",
                },
            }
        )
    return features


def within_hours(features: list[dict[str, Any]], now: datetime, hours: int) -> list[dict[str, Any]]:
    """Features acquired in the `hours` before `now`."""
    cutoff = (now - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return [f for f in features if f["properties"]["acquired"] >= cutoff]


def fetch_firms(key: str) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    for source in FIRMS_SOURCES:
        text = fetch(FIRMS_URL.format(key=key, source=source, bbox=CONUS_BBOX)).decode("utf-8")
        if not text.startswith("latitude"):
            # FIRMS answers errors (bad key, rate limit) as plain text with HTTP 200.
            raise RuntimeError(f"FIRMS {source}: {text[:120]!r}")
        features.extend(parse_firms(text, source))
    return features


def hms_time(value: str) -> str | None:
    """HMS times look like "2026293 1200": year, day of year, then HHMM in UTC."""
    try:
        stamp = datetime.strptime(value.strip(), "%Y%j %H%M").replace(tzinfo=UTC)
    except ValueError:
        return None
    return stamp.strftime("%Y-%m-%dT%H:%M:%SZ")


def _ring(points: list[tuple[float, float]]) -> list[list[float]]:
    return [[round(x, 4), round(y, 4)] for x, y in points]


def parse_hms(shp_path: Path) -> list[dict[str, Any]]:
    reader = shapefile.Reader(str(shp_path))
    names = [f[0].lower() for f in reader.fields[1:]]
    features = []
    for shape_record in reader.iterShapeRecords():
        shape = shape_record.shape
        if not shape.points:
            continue
        props = dict(zip(names, shape_record.record))
        starts = list(shape.parts) + [len(shape.points)]
        rings = [_ring(shape.points[a:b]) for a, b in zip(starts, starts[1:])]
        features.append(
            {
                "type": "Feature",
                # HMS plumes are simple outlines; each part is its own ring.
                "geometry": {"type": "Polygon", "coordinates": rings},
                "properties": {
                    "density": str(props.get("density", "")).strip() or "Unknown",
                    "satellite": str(props.get("satellite", "")).strip(),
                    "start": hms_time(str(props.get("start", ""))),
                    "end": hms_time(str(props.get("end", ""))),
                },
            }
        )
    return features


def fetch_hms(today: date) -> tuple[date, list[dict[str, Any]]]:
    """Today's plumes, or yesterday's while today's file isn't out yet."""
    for day in (today, today - timedelta(days=1)):
        url = HMS_URL.format(y=day.year, m=day.month, d=day.day)
        try:
            blob = fetch(url)
        except Exception as err:  # 404 until analysts publish the day's first file
            print(f"HMS {day}: {err}", file=sys.stderr)
            continue
        with tempfile.TemporaryDirectory() as tmp:
            zipfile.ZipFile(io.BytesIO(blob)).extractall(tmp)
            shp = next(Path(tmp).glob("*.shp"))
            return day, parse_hms(shp)
    raise RuntimeError("no HMS smoke file for today or yesterday")


def main(out_dir: str) -> None:
    out = Path(out_dir)
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    key = os.environ.get("FIRMS_MAP_KEY", "")
    if key:
        hotspots = within_hours(fetch_firms(key), datetime.now(UTC), 24)
        write_json(out / "live/fire/firms.geojson", feature_collection(hotspots, updated=now, source="NASA FIRMS", hours=24))
        print(f"FIRMS: {len(hotspots)} hotspots")
    else:
        print("FIRMS_MAP_KEY not set; skipping hotspots", file=sys.stderr)
    day, plumes = fetch_hms(datetime.now(UTC).date())
    write_json(out / "live/fire/smoke.geojson", feature_collection(plumes, updated=now, day=day.isoformat(), source="NOAA HMS"))
    print(f"HMS smoke {day}: {len(plumes)} plumes")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
