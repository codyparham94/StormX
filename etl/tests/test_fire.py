from pathlib import Path

import shapefile

from stormx_etl.fire import hms_time, modis_confidence, parse_firms, parse_hms

VIIRS_CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
34.12346,-118.54321,330.5,0.4,0.5,2026-10-20,905,N,VIIRS,h,2.0NRT,290.1,12.3,N
bad,row,,,,,,,,,,,,
"""

MODIS_CSV = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
30.5,-91.2,310.0,1.0,1.0,2026-10-20,1830,Aqua,MODIS,85,6.1NRT,295.0,,D
"""


def test_parse_viirs():
    [f] = parse_firms(VIIRS_CSV, "VIIRS_NOAA20_NRT")
    assert f["geometry"]["coordinates"] == [-118.5432, 34.1235]
    assert f["properties"] == {
        "source": "VIIRS NOAA20",
        "acquired": "2026-10-20T09:05:00Z",
        "confidence": "high",
        "frp": 12.3,
        "daynight": "night",
    }


def test_parse_modis():
    [f] = parse_firms(MODIS_CSV, "MODIS_NRT")
    assert f["properties"]["confidence"] == "high"
    assert f["properties"]["frp"] is None
    assert f["properties"]["daynight"] == "day"


def test_modis_confidence_bands():
    assert [modis_confidence(v) for v in ("10", "50", "90", "x")] == ["low", "nominal", "high", "unknown"]


def test_hms_time():
    assert hms_time("2026293 1200") == "2026-10-20T12:00:00Z"
    assert hms_time("") is None


def test_parse_hms(tmp_path: Path):
    path = tmp_path / "smoke"
    with shapefile.Writer(str(path), shapeType=shapefile.POLYGON) as w:
        for name, size in (("Satellite", 20), ("Start", 12), ("End", 12), ("Density", 7)):
            w.field(name, "C", size=size)
        w.poly([[[-100, 40], [-99, 40], [-99, 41], [-100, 41], [-100, 40]]])
        w.record("GOES-EAST", "2026293 1200", "2026293 1500", "Heavy")
    [f] = parse_hms(path.with_suffix(".shp"))
    assert f["geometry"]["type"] == "Polygon"
    assert len(f["geometry"]["coordinates"][0]) == 5
    assert f["properties"] == {"density": "Heavy", "satellite": "GOES-EAST", "start": "2026-10-20T12:00:00Z", "end": "2026-10-20T15:00:00Z"}
