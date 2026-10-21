from stormx_etl.grid import slim
from stormx_etl.outages import parse_counties, summarize_status

SQUARE = [[[-90.123456789, 30.0], [-90.0, 30.0], [-90.0, 30.1], [-90.123456789, 30.0]]]


def county(fips, out, utilities, geometry_type="Polygon"):
    return {
        "id": fips,
        "countyName": "Orleans",
        "stateName": "Louisiana",
        "metersOut": out,
        "feature": {"type": geometry_type, "coordinates": SQUARE},
        "outages": [{"metersOut": n, "utilityName": u} for u, n in utilities],
    }


def test_parse_counties_sums_utilities_and_sorts():
    features = parse_counties(
        [
            county("22071", 30, [("ENTERGY LOUISIANA ", 20), ("CLECO", 10)]),
            county("22051", 0, [("ENTERGY LOUISIANA", 0)]),
            county("22103", 50, [("CLECO", 50)]),
            county("22087", 5, [("CLECO", 5)], geometry_type="Point"),
        ]
    )
    assert [f["properties"]["fips"] for f in features] == ["22103", "22071"]
    orleans = features[1]
    assert orleans["properties"]["customers_out"] == 30
    assert orleans["properties"]["utilities"] == "CLECO; ENTERGY LOUISIANA"
    assert orleans["geometry"]["coordinates"][0][0] == [-90.12346, 30.0]


def test_summarize_status():
    status = [
        {"hasError": False, "receivedDate": "2026-10-21T10:38:50Z"},
        {"hasError": False, "receivedDate": "2026-10-21T10:40:00Z"},
        {"hasError": True, "receivedDate": "2026-10-21T11:00:00Z"},
    ]
    assert summarize_status(status) == {"utilities": 3, "utilities_ok": 2, "latest_report": "2026-10-21T10:40:00Z"}


def test_slim_substation_drops_unknown_numbers():
    feature = {
        "geometry": {"type": "Point", "coordinates": [-90.0712345, 29.9512345]},
        "properties": {"NAME": "PAris", "STATE": "LA", "MAX_VOLT": 230, "MIN_VOLT": -999999, "LINES": 4, "EXTRA": 1},
    }
    slimmed = slim(feature)
    assert slimmed["geometry"]["coordinates"] == [-90.07123, 29.95123]
    assert slimmed["properties"]["MIN_VOLT"] is None
    assert slimmed["properties"]["MAX_VOLT"] == 230
    assert "EXTRA" not in slimmed["properties"]
    assert slim({"geometry": None, "properties": {}}) is None
