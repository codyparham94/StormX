import json

import h3
import pytest

from stormx_etl import risk
from stormx_etl.exposure import add_lines, county_cells, haversine_km, line_km_by_cell, percentile


def square(lon, lat, size=0.2):
    ring = [[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]
    return {"type": "Polygon", "coordinates": [ring]}


def collection(*features):
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": p, "geometry": g} for p, g in features]}


def test_line_km_by_cell_adds_up_to_the_line():
    line = [[-97.0, 35.0], [-96.5, 35.0], [-96.5, 35.3]]
    cells = line_km_by_cell(line)
    total = haversine_km((-97.0, 35.0), (-96.5, 35.0)) + haversine_km((-96.5, 35.0), (-96.5, 35.3))
    assert sum(cells.values()) == pytest.approx(total)
    assert len(cells) > 10


def test_add_lines_ignores_unknown_voltage():
    from collections import defaultdict

    cells = defaultdict(lambda: [0.0, 0, 0, 0.0, ""])
    add_lines(cells, [{"geometry": {"type": "LineString", "coordinates": [[-97, 35], [-97.01, 35]]}, "properties": {"VOLTAGE": -999999}}])
    add_lines(cells, [{"geometry": {"type": "MultiLineString", "coordinates": [[[-97, 35], [-97.01, 35]]]}, "properties": {"VOLTAGE": 345}}])
    assert {row[2] for row in cells.values()} == {345}


def test_percentile_skips_empty_cells():
    assert percentile([0, 0, 0, 1, 2, 3, 4], 0.5) == 3
    assert percentile([0, 0], 0.95) == 1.0


def test_county_cells_falls_back_for_tiny_counties():
    assert len(county_cells(square(-97, 35, 1.0))) > 50
    tiny = square(-77.03, 38.89, 0.001)
    assert county_cells(tiny) == {h3.latlng_to_cell(38.89, -77.03, 6)}


def test_spc_scores():
    wind = risk.probability(risk.WIND, "damaging wind")
    assert wind({"LABEL": "0.15"}) == (0.5, "SPC: 15% chance of damaging wind")
    assert wind({"LABEL": "SIGN"}) is None
    assert risk.categorical({"LABEL": "ENH"}) == (0.55, "SPC: enhanced severe risk")


def test_winter_and_alert_scores():
    ice = risk.winter(risk.ICE, "ice")
    assert ice({"impact": "MAJOR"}) == (0.8, "WPC: major ice impacts, days 1 to 3")
    assert ice({"impact": "WINTER WEATHER AREA"}) == (0.15, "WPC: winter weather, days 1 to 3")
    assert risk.alert({"prod_type": "Tornado Warning"}) == (0.9, "NWS: Tornado Warning")
    assert risk.alert({"prod_type": "Small Craft Advisory"}) is None


def test_tropical_scales_by_wind_speed():
    assert risk.tropical(9)({"PWIND120": 40}) == (0.4, "NHC: 40% chance of 64 kt winds in 5 days")
    assert risk.tropical(7)({"PWIND120": 40})[0] == 0.2


def test_polygon_cells_catches_thin_warnings_and_skips_the_antimeridian():
    thin = {"type": "Polygon", "coordinates": [[[-97, 35], [-96.5, 35], [-96.5, 35.0005], [-97, 35.0005], [-97, 35]]]}
    assert risk.polygon_cells(thin)
    wrapped = {"type": "Polygon", "coordinates": [[[179.5, 52], [-179.5, 52], [-179.5, 53], [179.5, 53], [179.5, 52]]]}
    assert risk.polygon_cells(wrapped) == set()
    assert risk.polygon_cells({"type": "Point", "coordinates": [0, 0]}) == set()
    assert risk.polygon_cells({"type": "Polygon", "coordinates": [[[-97, 35], [-96, 35]]]}) == set()


def test_significant_areas_add_to_probability():
    source = risk.Source("SPC wind", [], risk.probability(risk.WIND, "damaging wind"), intensity=True)
    scores = risk.source_scores(source, [collection(({"LABEL": "0.15"}, square(-97, 35)), ({"LABEL": "SIGN"}, square(-97, 35, 0.1)))])
    inside = h3.latlng_to_cell(35.05, -96.95, 6)
    outside = h3.latlng_to_cell(35.17, -96.83, 6)
    assert scores[inside] == (0.6, "SPC: 15% chance of damaging wind, significant")
    assert scores[outside] == (0.5, "SPC: 15% chance of damaging wind")


def test_combine_keeps_the_worst_hazard():
    a = {"x": (0.3, "A"), "y": (0.9, "A")}
    b = {"x": (0.5, "B")}
    assert risk.combine([a, b]) == {"x": (0.5, "B"), "y": (0.9, "A")}


def test_risk_needs_a_hazard():
    assert risk.risk_score(0, 1, 1) == 0
    assert risk.risk_score(1, 1, 1) == 100
    assert risk.risk_score(0.5, 0, 0) == 25
    assert [risk.level(r) for r in (0, 14, 15, 30, 50, 70, 100)] == ["Low", "Low", "Elevated", "High", "Very high", "Extreme", "Extreme"]
    assert risk.customers_affected(10_000, 50) == 1000


def test_county_ranks():
    counties = [{"properties": {"fips": f, "hours_per_customer": h}} for f, h in (("a", 1), ("b", 9), ("c", None), ("d", 4))]
    assert risk.county_ranks(counties) == {"a": 1 / 6, "d": 0.5, "b": 5 / 6}


def test_main_writes_cells_counties_and_summary(tmp_path):
    data = tmp_path / "data"
    inside = h3.latlng_to_cell(35.1, -96.9, 6)
    quiet = h3.latlng_to_cell(40.0, -100.0, 6)
    exposure = {
        "meta": {"updated": "2026-10-01T00:00:00Z", "columns": ["line_km", "substations", "max_kv", "customers", "fips", "far_from_substation"], "p95": {"line_km": 20, "substations": 2, "customers": 5000}},
        "cells": {inside: [20, 2, 345, 5000, "40109", 0], quiet: [5, 0, 0, 100, "31001", 1]},
    }
    counties = collection(
        ({"fips": "40109", "name": "Oklahoma", "state": "OK", "customers": 300000, "hours_per_customer": 9}, square(-97.2, 35.0, 0.5)),
        ({"fips": "31001", "name": "Adams", "state": "NE", "customers": 15000, "hours_per_customer": 2}, square(-100.2, 39.9, 0.5)),
    )
    (data / "risk").mkdir(parents=True)
    (data / "history/outages").mkdir(parents=True)
    (data / "risk/exposure-res6.json").write_text(json.dumps(exposure))
    (data / "history/outages/counties.geojson").write_text(json.dumps(counties))

    def fetcher(source):
        if source.name == "SPC tornado":
            return [collection(({"LABEL": "0.10"}, square(-97, 35)))]
        if source.name == "NWS alerts":
            raise TimeoutError("timed out")
        return [collection()]

    risk.main(str(tmp_path / "out"), str(data), fetcher)
    out = tmp_path / "out/risk"
    cells = json.loads((out / "h3-res6.json").read_text())
    assert [row[0] for row in cells["cells"]] == [inside]
    row = dict(zip(cells["meta"]["columns"], cells["cells"][0], strict=True))
    assert cells["meta"]["drivers"][row["driver"]] == "SPC: 10% chance of a tornado"
    # Full exposure, the worst-ranked county and a nearby substation: 0.6 × (0.5 + 0.3 + 0.2 × 0.525).
    assert row["risk"] == 54
    rollup = json.loads((out / "counties.geojson").read_text())["features"]
    assert [f["properties"]["fips"] for f in rollup] == ["40109"]
    assert rollup[0]["properties"]["level"] == "Very high"
    summary = json.loads((out / "summary.json").read_text())
    assert summary["sources"]["NWS alerts"] == {"ok": False, "error": "timed out"}
    assert summary["sources"]["SPC tornado"]["ok"]
    assert summary["top"][0]["name"] == "Oklahoma"
    assert summary["cells"]["Very high"] == 1
    assert summary["counties"] == {"Extreme": 0, "Very high": 1, "High": 0, "Elevated": 0, "Low": 0}


def test_main_fails_when_every_feed_fails(tmp_path):
    data = tmp_path / "data"
    (data / "risk").mkdir(parents=True)
    (data / "history/outages").mkdir(parents=True)
    (data / "risk/exposure-res6.json").write_text(json.dumps({"meta": {"updated": "x", "columns": [], "p95": {}}, "cells": {}}))
    (data / "history/outages/counties.geojson").write_text(json.dumps(collection()))

    def fetcher(source):
        raise OSError("down")

    with pytest.raises(RuntimeError, match="Every hazard feed failed"):
        risk.main(str(tmp_path / "out"), str(data), fetcher)
