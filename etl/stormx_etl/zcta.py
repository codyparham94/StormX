"""ZIP code centroids for the forecast popup, from the Census ZCTA Gazetteer file.

    python -m stormx_etl.zcta OUT_DIR

Writes OUT_DIR/static/zcta.json as {"70112": [29.957, -90.077], ...} (latitude, longitude).
"""

from __future__ import annotations

import io
import sys
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from .common import fetch, write_json

GAZETTEER_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{year}_Gazetteer/{year}_Gaz_zcta_national.zip"


def parse_gazetteer(text: str) -> dict[str, list[float]]:
    lines = text.splitlines()
    # Tab-separated through 2025, pipe-separated from 2026.
    sep = "|" if "|" in lines[0] else "\t"
    header = [h.strip() for h in lines[0].split(sep)]
    zip_col, lat_col, lon_col = header.index("GEOID"), header.index("INTPTLAT"), header.index("INTPTLONG")
    out: dict[str, list[float]] = {}
    for line in lines[1:]:
        cells = [c.strip() for c in line.split(sep)]
        if len(cells) <= max(zip_col, lat_col, lon_col):
            continue
        try:
            out[cells[zip_col]] = [round(float(cells[lat_col]), 4), round(float(cells[lon_col]), 4)]
        except ValueError:
            continue
    return out


def main(out_dir: str) -> None:
    year = datetime.now(UTC).year
    # The Gazetteer for a year is published partway through it; fall back a year or two.
    for candidate in (year, year - 1, year - 2):
        try:
            blob = fetch(GAZETTEER_URL.format(year=candidate))
            break
        except Exception as err:
            print(f"Gazetteer {candidate}: {err}", file=sys.stderr)
    else:
        raise RuntimeError("no ZCTA Gazetteer file found")
    archive = zipfile.ZipFile(io.BytesIO(blob))
    text = archive.read(archive.namelist()[0]).decode("utf-8-sig")
    zips = parse_gazetteer(text)
    if len(zips) < 30000:
        raise RuntimeError(f"only {len(zips)} ZCTAs parsed; refusing to publish")
    write_json(Path(out_dir) / "static/zcta.json", zips)
    print(f"ZCTA {candidate}: {len(zips)} ZIP codes")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
