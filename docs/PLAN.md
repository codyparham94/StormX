# StormX project plan

StormX is a static map webapp at [storms.codyparham.com](https://storms.codyparham.com). It shows past and forecast storms over the U.S. power grid and scores where utility outages are likely. It is a GIS portfolio piece built on free tiers: ArcGIS Maps SDK for JavaScript, GitHub Pages for hosting, and Cloudflare R2 for data.

The living version of this plan is a Claude Doc. This file is a copy for the repo.

## Decisions

| Topic | Decision | What it means for the build |
| --- | --- | --- |
| Audience | Utility GIS hiring managers, emergency management, general recruiters | The landing view tells the story in 10 seconds, and the Methods page carries the depth |
| Extent | Whole CONUS | Pre-tiled national layers (PMTiles), no heavy queries per request |
| Storm types | All: tropical, severe convective (tornado, hail, wind, derecho), winter/ice, wildfire and red-flag wind, flooding, extreme heat/cold | One hazard layer per type, combined in the risk index |
| History | 2014 to present | Matches the EAGLE-I outage records |
| Future storms | Live feeds plus a replayable scenario mode | Scenario mode is the demo that always works |
| Risk model | Weighted index in v1, ML model in v2 | v2 adds a backtest page |
| Assessment units | H3 hex, census tract, county, and each line or substation | H3 is the base grid, tracts and counties are rollups, and assets get their own score |
| Outputs | Risk level plus estimated customers affected | Customer counts come from Census households (no restoration times) |
| Grid data | HIFLD snapshot on R2, with attribution | |
| Fake data | A fictional utility in one demo region | Gulf Coast |
| ArcGIS | Location Platform developer account | API key restricted by referrer |
| Cost | Strictly free, with usage caps on | Data self-hosted on R2, and Esri calls limited to basemaps |
| 3D | 2D main view plus one 3D view | A 3D scene of a hurricane landfall (surge and terrain) |
| Stack | Vite + TypeScript + Calcite | |
| Refresh | GitHub Action every 1 to 6 hours | |
| DNS | codyparham.com is on Cloudflare | The Pages CNAME and the R2 custom domain are both set there |
| Must-have UI | Time slider, track playback, layer list, risk legend, county popups, printable PDF | The PDF is built in the browser (screenshot + jsPDF), with no paid print service |
| Write-up | Yes | Page covering methods, data lineage and architecture |
| Deadline | None | Phases are not dated |

## Architecture

```
Weather feeds (NHC, SPC, NDFD, NWS) ─┐
Grid (HIFLD lines, substations)      ─┤
Outage + storm history (EAGLE-I,     ─┼─> GitHub Actions ETL ──upload──> Cloudflare R2 (data.codyparham.com)
  Storm Events)                       │   Python, GeoPandas, H3          GeoJSON, PMTiles, Parquet
Synthetic utility                    ─┘   every 1 to 6 hours                     │ fetch
                                                                                  v
                                   storms.codyparham.com on GitHub Pages
                                   Vite + TypeScript, ArcGIS Maps SDK, Calcite
                                   Esri basemaps; live NWS alerts called from the browser
```

The ArcGIS API key is restricted by referrer to storms.codyparham.com, so it is safe in client code. The R2 write key lives only in GitHub Actions secrets.

## Data sources

| Source | What it gives us | Role |
| --- | --- | --- |
| [OSTI 2500278](https://www.osti.gov/biblio/2500278) | Probably ORNL EAGLE-I county outage records (not yet verified) | Historical outages and model training |
| [OSTI 3012826](https://www.osti.gov/biblio/3012826) | Not yet verified | TBD |
| [Rutgers HIFLD MapServer](https://oceandata.rad.rutgers.edu/arcgis/rest/services/RenewableEnergy/HIFLD_Electric_SubstationsTransmissionLines/MapServer) | HIFLD substations and transmission lines | Grid layer, snapshotted to R2 |
| [FWS transmission lines](https://gis-fws.opendata.arcgis.com/datasets/fws::us-electric-power-transmission-lines/about) | HIFLD transmission lines on ArcGIS Hub | Download source |
| [Data Rescue Project](https://portal.datarescueproject.org/datasets/hifld-open-transmission-lines/) | Archived HIFLD Open transmission lines | Backup source |
| NOAA NHC GIS, IBTrACS, HURDAT2 | Hurricane tracks, wind radii, forecast cones | Past and future hurricanes |
| NWS API (api.weather.gov) | Active warnings and watches as GeoJSON | Live alerts |
| NOAA Storm Events Database | Tornado, hail, wind, ice, flood events | Past severe storms |
| SPC outlooks and storm reports | Day 1 to 3 convective risk | Future severe weather |
| NDFD / NBM grids | Forecast wind gust, ice, snow, temperature | Main hazard driver |
| Census TIGER + ACS | Boundaries, households, population | Exposure and customer estimates |
| HIFLD / EIA-861 service territories | Utility service areas | Who is affected |
| Synthetic | Fictional Gulf Coast utility: feeders, customers, outage tickets | Utility operations demo, labeled "simulated" in the UI |

## Risk model (v1)

A 0 to 100 index per H3 hex (resolution 6 nationally, 8 in the demo region), rolled up to tracts and counties. Each transmission line segment and substation also gets its own score.

- **Hazard (50%):** the worst active hazard in the hex: peak wind gust, hurricane wind radii, ice accretion, snow load, tornado/hail probability, flood depth, red-flag wind, or extreme heat/cold load stress. Each is scaled against an outage threshold.
- **Exposure (30%):** transmission line miles, substation count and voltage class, and households.
- **Vulnerability (20%):** tree canopy, the county's historical outage rate from EAGLE-I, and distance to a substation.
- **v2:** a gradient-boosted model trained on past storms, compared with the index on a backtest page.

## Features

- Live view: NWS warnings, NHC cones, SPC outlooks, and risk hexes over the grid.
- Storm history: pick a past storm and replay its track with a time slider, showing actual outages next to the modeled risk.
- Scenario mode: a scripted fake hurricane for demos.
- Asset impact: a sortable table of at-risk substations and lines, with CSV export.
- County report popup with a printable PDF.
- One 3D landfall view.
- About page covering methods, data lineage and architecture.

## Roadmap

1. **Foundation:** the repo, Pages with the custom domain, the R2 bucket with CORS, an ArcGIS key and basemap, and grid layers on the map.
2. **Storm history:** past storm picker, track playback slider, and an EAGLE-I outage overlay.
3. **Live risk:** the ETL Action writing to R2, NWS/NHC/SPC feeds, the H3 risk layer, and county popups.
4. **Showcase:** scenario mode, the ML model and backtest, the 3D view, the About page, and mobile polish.

## Setup steps (owner)

- [ ] Create the R2 bucket `stormx-data`.
- [ ] Connect the custom domain `data.codyparham.com` to the bucket.
- [ ] Add a CORS rule that allows GET from `https://storms.codyparham.com` and `http://localhost:5173`.
- [ ] Create an R2 API token (Object Read & Write, this bucket only) and add these repo Actions secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- [ ] Create an ArcGIS Location Platform API key with basemap access only, restricted by referrer to `storms.codyparham.com` and `localhost`.
- [ ] Add a Cloudflare DNS CNAME `storms` that points to `codyparham94.github.io` with the proxy off, then set the custom domain in the repo's Pages settings.
