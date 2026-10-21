from stormx_etl.history import CountyStats, add_year, aggregate, county_properties, find_events, month_files, national_daily

CSV = """﻿fips_code,county,state,customers_out,run_start_time
1001,Autauga,Alabama,10,2021-02-15 00:00:00
1001,Autauga,Alabama,30,2021-02-15 00:15:00
48201,Harris,Texas,500,2021-02-15 00:15:00
48201,Harris,Texas,0,2021-02-16 00:00:00
48201,Harris,Texas,200,2021-03-01 12:00:00
48201,Harris,Texas,bad,2021-03-01 12:15:00
""".splitlines()


def test_aggregate_daily_peaks_and_snapshots():
    totals = aggregate(CSV)
    assert totals.county_days[("01001", "2021-02-15")] == [30, 40]
    assert totals.county_days[("48201", "2021-02-15")] == [500, 500]
    assert ("48201", "2021-02-16") not in totals.county_days
    assert totals.snapshots["2021-02-15 00:15:00"] == 530
    assert national_daily(totals.snapshots) == {"2021-02-15": 530, "2021-03-01": 200}
    assert totals.states["48201"] == "Texas"


def test_month_files_are_dense_per_county():
    months = month_files(aggregate(CSV), 2021)
    feb = months["2021-02"]
    assert len(feb["days"]) == 28 and feb["days"][14] == "2021-02-15"
    assert feb["peak"]["48201"][14] == 500 and sum(feb["peak"]["48201"]) == 500
    assert feb["national"][14] == 530 and sum(feb["national"]) == 530
    assert months["2021-03"]["peak"] == {"48201": [200] + [0] * 30}


def test_find_events_grows_around_the_peak_and_skips_quiet_days():
    national = {f"2021-02-{d:02d}": 1000 for d in range(1, 29)}
    national |= {"2021-02-14": 2_000_000, "2021-02-15": 4_000_000, "2021-02-16": 3_000_000, "2021-02-17": 900_000, "2021-02-10": 50_000}
    state_peaks = {"2021-02-15": {"Texas": 3_500_000, "Louisiana": 300_000, "Oklahoma": 100_000, "": 5}}
    # Sorted by date. 50,000 is more than three times the usual 1,000, so it counts.
    small, big = find_events(national, state_peaks, count=3)
    assert small["peak_day"] == "2021-02-10"
    # 900,000 on the 17th is under a quarter of the way up to the 4,000,000 peak, so it is its own
    # event at first, then joins the big one because they touch.
    assert (big["start"], big["end"], big["peak_day"], big["peak"]) == ("2021-02-14", "2021-02-17", "2021-02-15", 4_000_000)
    assert big["states"] == ["Texas", "Louisiana", "Oklahoma"]


def test_county_averages():
    stats: dict[str, CountyStats] = {}
    totals = aggregate(CSV)
    add_year(stats, totals, 2021, {"48201": 1000, "01001": 25000})
    harris = county_properties("48201", "Harris", "TX", 1000, stats["48201"], 1)
    # (500 + 200) customer snapshots of 15 minutes over 1,000 customers.
    assert harris["hours_per_customer"] == 0.17
    assert harris["outage_days"] == 2
    assert (harris["worst"], harris["worst_day"], harris["worst_pct"]) == (500, "2021-02-15", 50.0)
    # Under 1% of Autauga's customers, so not an outage day.
    assert stats["01001"].outage_days == 0
    assert county_properties("99999", "X", "TX", 0, None, 1) == {"fips": "99999", "name": "X", "state": "TX", "customers": None}
    # A modeled count below the worst reported outage is raised to it, so shares stay at or under 100%.
    assert county_properties("48201", "Harris", "TX", 100, stats["48201"], 1)["worst_pct"] == 100.0


def test_total_customers_column_is_read_when_present():
    lines = ["fips_code,county,state,customers_out,run_start_time,total_customers", "01001,Autauga,Alabama,2,2024-01-01 00:15:00,29666"]
    assert aggregate(lines).served == {"01001": 29666}


def test_2023_sum_column():
    lines = ["fips_code,county,state,sum,run_start_time", "01003,Baldwin,Alabama,7,2023-01-01 00:00:00"]
    assert aggregate(lines).county_days[("01003", "2023-01-01")] == [7, 7]
