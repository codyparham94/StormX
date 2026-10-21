import json
from datetime import UTC, datetime, timedelta

import h3

from stormx_etl import sim

NOW = datetime(2026, 10, 21, 16, 0, tzinfo=UTC)


def test_network_is_the_same_every_run():
    substations, feeders = sim.build_network()
    assert (substations, feeders) == sim.build_network()
    assert len(substations) == 5
    assert 25 <= len(feeders) <= 35
    assert len({f["properties"]["feeder"] for f in feeders}) == len(feeders)
    assert all(f["properties"]["customers"] > 0 for f in feeders)


def test_territory_wraps_the_network():
    _, feeders = sim.build_network()
    area = sim.territory(feeders)
    ring = area["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1]
    assert area["properties"]["customers"] == sum(f["properties"]["customers"] for f in feeders)


def test_convex_hull():
    square = [(0, 0), (1, 0), (1, 1), (0, 1), (0.5, 0.5)]
    assert sim.convex_hull(square) == [(0, 0), (1, 0), (1, 1), (0, 1)]


def test_storms_bring_more_tickets_and_stay_stable_within_the_hour():
    _, feeders = sim.build_network()
    calm = sum(len(sim.new_tickets(f, 0, "", NOW)) for f in feeders)
    stormy = sum(len(sim.new_tickets(f, 80, "NWS: Tornado Warning", NOW)) for f in feeders)
    assert stormy > calm * 3
    # A rerun in the same hour makes the same tickets, so carrying the last run's over can't duplicate them.
    def same(tickets):
        return [(t["properties"]["ticket"], t["properties"]["cause"], t["geometry"]) for t in tickets]

    assert same(sim.new_tickets(feeders[0], 80, "x", NOW)) == same(sim.new_tickets(feeders[0], 80, "x", NOW.replace(minute=40)))


def test_ticket_status_over_time():
    props = {"reported": "2026-10-21T15:00:00Z", "restore_minutes": 120, "customers_affected": 40}

    def at(minutes):
        return sim.ticket_status(props, datetime(2026, 10, 21, 15, 0, tzinfo=UTC) + timedelta(minutes=minutes))

    assert [at(m) for m in (5, 30, 90, 120)] == [("Reported", 40), ("Crew assigned", 40), ("Crew on site", 40), ("Restored", 0)]


def test_cause_kind():
    assert sim.cause_kind("WPC: major ice impacts, days 1 to 3") == "winter"
    assert sim.cause_kind("SPC: 15% chance of damaging wind") == "wind"
    assert sim.cause_kind("") == "everyday"


def test_run_scores_feeders_and_carries_tickets_over(tmp_path):
    _, feeders = sim.build_network()
    lon, lat = feeders[0]["geometry"]["coordinates"][0][3]
    cell = h3.latlng_to_cell(lat, lon, 6)
    out = tmp_path / "out"
    (out / "risk").mkdir(parents=True)
    (out / "risk/h3-res6.json").write_text(json.dumps({"meta": {"columns": ["cell", "risk", "driver"], "drivers": ["NWS: Tornado Warning"]}, "cells": [[cell, 72, 0]]}))
    data = tmp_path / "data"
    (data / "sim").mkdir(parents=True)
    old = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "ticket": "T102114-101-1",
            "feeder": feeders[0]["properties"]["feeder"],
            "substation": "Cypress Bend",
            "cause": "Tree on line",
            "scope": "Feeder lockout",
            "customers_affected": 500,
            "reported": "2026-10-21T14:30:00Z",
            "restore_minutes": 600,
        },
    }
    stale = json.loads(json.dumps(old))
    stale["properties"] |= {"ticket": "T102101-101-1", "reported": "2026-10-21T01:00:00Z"}
    (data / "sim/tickets.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [old, stale]}))

    summary = sim.run(str(out), str(data), NOW)
    written = json.loads((out / "sim/feeders.geojson").read_text())["features"]
    first = written[0]["properties"]
    assert first["risk"] == 72 and first["hazard"] == "NWS: Tornado Warning"
    assert first["status"] == "Locked out"
    tickets = {t["properties"]["ticket"]: t["properties"] for t in json.loads((out / "sim/tickets.geojson").read_text())["features"]}
    assert tickets["T102114-101-1"]["status"] == "Crew on site"
    assert "T102101-101-1" not in tickets
    assert summary["simulated"] and summary["utility"] == "StormX Demo Electric"
    assert summary["customers_out"] >= min(500, first["customers"])
    assert summary["max_risk"] == 72
