"""Outage history from ORNL EAGLE-I, 2014 to 2025, rolled up for the outage history replay and the
county heatmap.

EAGLE-I counts customers out per county every 15 minutes, scraped from utility outage maps. The
yearly CSVs are 0.1 to 1.4 GB, so this streams each one from Figshare and keeps only daily county
totals. Days are UTC dates, as the source times are UTC.

    python -m stormx_etl.history OUT_DIR [YEAR ...]

Writes, under OUT_DIR/history/outages/:
    daily/YYYY-MM.json     each county's peak customers out per day, for the replay
    events.json            the biggest outage events nationally, for the storm picker
    counties.geojson       county shapes with customers and outage averages, for the heatmap
"""

from __future__ import annotations

import csv
import http.client
import io
import sys
import tempfile
import time
import urllib.request
import zipfile
from calendar import monthrange
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from statistics import median
from typing import Any

import shapefile

from .common import USER_AGENT, feature_collection, fetch, write_json

# Figshare 10.6084/m9.figshare.24237376 (CC BY 4.0): one CSV per year, plus modeled customers.
FILE_IDS = {
    2014: 42547717,
    2015: 42547822,
    2016: 42547825,
    2017: 42547828,
    2018: 42547879,
    2019: 42547885,
    2020: 42547894,
    2021: 42547891,
    2022: 42547897,
    2023: 44574907,
    2024: 53581661,
    2025: 62164877,
}
MCC_ID = 42547708
DOWNLOAD = "https://ndownloader.figshare.com/files/{id}"
COUNTIES_URL = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_20m.zip"

# 2014 starts in November, so the averages use whole years only.
AVERAGE_YEARS = range(2015, 2026)
SNAPSHOT_HOURS = 0.25
EVENT_COUNT = 60
EVENT_MAX_DAYS = 14


@dataclass
class YearTotals:
    """One year of EAGLE-I, reduced to daily numbers."""

    # (fips, "YYYY-MM-DD") -> [peak customers out, sum of the 15-minute counts]
    county_days: dict[tuple[str, str], list[int]] = field(default_factory=lambda: defaultdict(lambda: [0, 0]))
    # "YYYY-MM-DD HH:MM:SS" -> customers out nationally at that snapshot
    snapshots: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    # fips -> state name
    states: dict[str, str] = field(default_factory=dict)
    # fips -> customers served, from the total_customers column that only some years have
    served: dict[str, int] = field(default_factory=dict)


def aggregate(lines: Iterable[str]) -> YearTotals:
    """Reduces EAGLE-I CSV lines (header first) to daily peaks and sums per county."""
    totals = YearTotals()
    reader = csv.reader(lines)
    header = [h.strip().lstrip("﻿") for h in next(reader)]
    fips_col, state_col = header.index("fips_code"), header.index("state")
    out_col, time_col = header.index("customers_out"), header.index("run_start_time")
    served_col = header.index("total_customers") if "total_customers" in header else None
    days, snapshots, states, served = totals.county_days, totals.snapshots, totals.states, totals.served
    for row in reader:
        try:
            out = int(float(row[out_col]))
        except (ValueError, IndexError):
            continue
        if out <= 0:
            continue
        fips, when = row[fips_col].zfill(5), row[time_col]
        day = days[(fips, when[:10])]
        day[1] += out
        if out > day[0]:
            day[0] = out
        snapshots[when] += out
        if fips not in states:
            states[fips] = row[state_col]
            if served_col is not None:
                try:
                    served[fips] = int(float(row[served_col]))
                except (ValueError, IndexError):
                    pass
    return totals


def stream_year(year: int) -> Iterator[str]:
    """Lines of one year's CSV, read straight off the network."""
    request = urllib.request.Request(DOWNLOAD.format(id=FILE_IDS[year]), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as response:
        yield from io.TextIOWrapper(response, encoding="utf-8-sig", newline="")


def aggregate_year(year: int, attempts: int = 3) -> YearTotals:
    """Streams and reduces one year, starting over if the download breaks partway."""
    for attempt in range(1, attempts + 1):
        try:
            return aggregate(stream_year(year))
        except (OSError, http.client.HTTPException) as err:
            if attempt == attempts:
                raise
            print(f"EAGLE-I {year}: download broke ({err}); retrying", flush=True)
            time.sleep(30 * attempt)
    raise AssertionError("unreachable")


def load_customers() -> dict[str, int]:
    """EAGLE-I's modeled customers per county (as of 2022)."""
    text = fetch(DOWNLOAD.format(id=MCC_ID)).decode("utf-8-sig")
    customers = {}
    for row in csv.DictReader(io.StringIO(text)):
        try:
            customers[row["County_FIPS"].strip().zfill(5)] = int(float(row["Customers"]))
        except (KeyError, ValueError):
            continue
    return customers


def month_files(totals: YearTotals, year: int) -> dict[str, dict[str, Any]]:
    """Per month: the days, the worst national total each day, and each county's daily peak for
    counties with any outage."""
    national = national_daily(totals.snapshots)
    by_month: dict[str, dict[str, list[int]]] = defaultdict(dict)
    for (fips, day), (peak, _) in totals.county_days.items():
        if not day.startswith(str(year)):
            continue
        month = day[:7]
        days_in = monthrange(year, int(day[5:7]))[1]
        series = by_month[month].setdefault(fips, [0] * days_in)
        series[int(day[8:10]) - 1] = peak
    out = {}
    for month, counties in sorted(by_month.items()):
        first = date.fromisoformat(f"{month}-01")
        days = [(first + timedelta(days=i)).isoformat() for i in range(monthrange(first.year, first.month)[1])]
        out[month] = {"days": days, "national": [national.get(d, 0) for d in days], "peak": dict(sorted(counties.items()))}
    return out


def national_daily(snapshots: dict[str, int]) -> dict[str, int]:
    """The worst 15-minute national total of customers out on each day."""
    daily: dict[str, int] = {}
    for when, out in snapshots.items():
        day = when[:10]
        if out > daily.get(day, 0):
            daily[day] = out
    return daily


def find_events(
    national: dict[str, int],
    state_peaks: dict[str, dict[str, int]],
    count: int = EVENT_COUNT,
) -> list[dict[str, Any]]:
    """The biggest outage events: each is the worst day nationally plus the days around it that
    stay a quarter of the way up from the usual daily level to that peak, up to two weeks, never
    overlapping another event."""
    usual = median(national.values()) if national else 0
    taken: set[str] = set()
    events = []
    for peak_day, peak in sorted(national.items(), key=lambda kv: -kv[1]):
        if len(events) == count:
            break
        if peak < usual * 3:
            break
        if peak_day in taken:
            continue
        start = end = date.fromisoformat(peak_day)
        floor = usual + (peak - usual) / 4
        while (end - start).days + 1 < EVENT_MAX_DAYS:
            before, after = (start - timedelta(days=1)).isoformat(), (end + timedelta(days=1)).isoformat()
            grow_before = before not in taken and national.get(before, 0) >= floor
            grow_after = after not in taken and national.get(after, 0) >= floor
            if not (grow_before or grow_after):
                break
            if grow_after and (not grow_before or national[after] >= national[before]):
                end += timedelta(days=1)
            else:
                start -= timedelta(days=1)
        span = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
        taken.update(span)
        by_state = state_peaks.get(peak_day, {})
        top = [s for s, _ in sorted(by_state.items(), key=lambda kv: -kv[1]) if s][:3]
        events.append({"start": span[0], "end": span[-1], "peak_day": peak_day, "peak": peak, "states": top})
    return merge_touching(sorted(events, key=lambda e: e["start"]))


def merge_touching(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Joins events that end the day before the next begins, such as a hurricane's landfall day and
    the days after it, while the joined span stays within two weeks."""
    merged: list[dict[str, Any]] = []
    for event in events:
        last = merged[-1] if merged else None
        if last:
            touching = date.fromisoformat(last["end"]) + timedelta(days=1) == date.fromisoformat(event["start"])
            length = (date.fromisoformat(event["end"]) - date.fromisoformat(last["start"])).days + 1
            if touching and length <= EVENT_MAX_DAYS:
                bigger = event if event["peak"] > last["peak"] else last
                merged[-1] = {**bigger, "start": last["start"], "end": event["end"]}
                continue
        merged.append(event)
    return merged


@dataclass
class CountyStats:
    customer_hours: float = 0.0
    outage_days: int = 0
    worst: int = 0
    worst_day: str = ""
    years: set[int] = field(default_factory=set)


def add_year(stats: dict[str, CountyStats], totals: YearTotals, year: int, customers: dict[str, int]) -> None:
    """Adds one year to each county's running outage numbers. An outage day is a day when at
    least 1% of the county's customers (and at least 50) were out at once."""
    for (fips, day), (peak, total) in totals.county_days.items():
        county = stats.setdefault(fips, CountyStats())
        if peak > county.worst:
            county.worst, county.worst_day = peak, day
        if year in AVERAGE_YEARS:
            county.years.add(year)
            county.customer_hours += total * SNAPSHOT_HOURS
            served = customers.get(fips, 0)
            if peak >= 50 and served and peak >= served * 0.01:
                county.outage_days += 1


def county_properties(fips: str, name: str, state: str, customers: int, stats: CountyStats | None, years: int) -> dict[str, Any]:
    # Some modeled counts are below outages that were actually reported; trust the outages.
    if stats and stats.worst > customers:
        customers = stats.worst
    props: dict[str, Any] = {"fips": fips, "name": name, "state": state, "customers": customers or None}
    if stats and years:
        hours = stats.customer_hours / customers / years if customers else None
        props |= {
            "hours_per_customer": round(hours, 2) if hours is not None else None,
            "outage_days": round(stats.outage_days / years, 1),
            "worst": stats.worst,
            "worst_day": stats.worst_day,
            "worst_pct": round(100 * stats.worst / customers, 1) if customers else None,
        }
    return props


def _round(coords: Any) -> Any:
    if coords and isinstance(coords[0], (int, float)):
        return [round(c, 4) for c in coords]
    return [_round(c) for c in coords]


def county_shapes() -> Iterator[tuple[str, str, str, dict[str, Any]]]:
    """(fips, name, state, GeoJSON geometry) from the Census 1:20M cartographic boundaries."""
    with tempfile.TemporaryDirectory() as tmp:
        zipfile.ZipFile(io.BytesIO(fetch(COUNTIES_URL))).extractall(tmp)
        [shp] = Path(tmp).glob("*.shp")
        with shapefile.Reader(str(shp)) as reader:
            fields = [f[0] for f in reader.fields[1:]]
            for record in reader.iterShapeRecords():
                attrs = dict(zip(fields, record.record, strict=True))
                geometry = record.shape.__geo_interface__
                geometry = {"type": geometry["type"], "coordinates": _round(geometry["coordinates"])}
                yield attrs["GEOID"], attrs["NAME"], attrs["STUSPS"], geometry


def main(out_dir: str, years: list[int]) -> None:
    out = Path(out_dir) / "history/outages"
    # Modeled customers (2022), raised where a year's own total_customers column says more.
    customers = load_customers()
    stats: dict[str, CountyStats] = {}
    national: dict[str, int] = {}
    # Day -> state -> sum of county peaks, to name the states each event hit hardest.
    state_peaks: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for year in years:
        totals = aggregate_year(year)
        for month, data in month_files(totals, year).items():
            write_json(out / f"daily/{month}.json", data)
        for fips, served in totals.served.items():
            customers[fips] = max(customers.get(fips, 0), served)
        add_year(stats, totals, year, customers)
        national |= national_daily(totals.snapshots)
        for (fips, day), (peak, _) in totals.county_days.items():
            state_peaks[day][totals.states.get(fips, "")] += peak
        print(f"EAGLE-I {year}: {len(totals.county_days)} county-days, {len(totals.snapshots)} snapshots", flush=True)

    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    events = find_events(national, state_peaks)
    write_json(out / "events.json", {"updated": now, "source": "ORNL EAGLE-I", "events": events})

    averaged = len([y for y in years if y in AVERAGE_YEARS])
    features = [
        {"type": "Feature", "geometry": geometry, "properties": county_properties(fips, name, state, customers.get(fips, 0), stats.get(fips), averaged)}
        for fips, name, state, geometry in county_shapes()
    ]
    write_json(
        out / "counties.geojson",
        feature_collection(features, updated=now, source="ORNL EAGLE-I; Census cartographic boundaries", years=f"{min(AVERAGE_YEARS)}-{max(AVERAGE_YEARS)}"),
    )
    print(f"{len(events)} events, {len(features)} counties")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(args[0] if args else "out", [int(y) for y in args[1:]] or sorted(FILE_IDS))
