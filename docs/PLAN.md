# StormX project plan

StormX is a static map webapp at [storms.codyparham.com](https://storms.codyparham.com). It shows past and forecast storms over the U.S. power grid and scores where utility outages are likely. It is a GIS portfolio piece built on free tiers: ArcGIS Maps SDK for JavaScript, GitHub Pages for hosting, and Cloudflare R2 for data.

The living version of this plan is a Claude Doc. This file is a copy for the repo.

## Decisions

| Topic | Decision | What it means for the build |
| --- | --- | --- |
| Audience | Utility GIS hiring managers, emergency management, general recruiters | The landing view tells the story in 10 seconds, and the Methods page carries the depth |
| Extent | Whole CONUS | Pre-tiled national layers (PMTiles), no heavy queries per request |
| Storm types | All: tropical, severe convective (tornado, hail, wind, derecho), winter/ice, wildfire and red-flag wind, flooding, extreme heat/cold | One hazard layer per type, combined in the risk index |
| History | 2014 to present | Matches the EAGLE-I outage records (2014 to 2025 on Figshare) |
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
| UI style | Frutiger Aero frosted glass, with an ambient layer that follows the visitor's weather | See "UI design" below |
| Screens | Landing page, then Radar mode and Outage risk mode with a toggle at the top | See "Screens" below |
| Accounts | Optional and free: saved places, alerts, saved layer setups | Supabase Auth recommended, provider not yet chosen |
| Google Maps | Free features only: Maps URLs links, an optional Embed page | Never drawn on the ArcGIS map, per Google's terms |
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

Checked on 2026-10-20 by fetching each link the owner supplied. The Rutgers server could not be checked (see below).

### Outage history: ORNL EAGLE-I

The two OSTI records are yearly slices of the same dataset: ORNL's EAGLE-I county outage counts, scraped from utility outage maps every 15 minutes. Both belong to the EAGLE-I parent DOI [10.13139/ORNLNCCS/1975203](https://doi.org/10.13139/ORNLNCCS/1975203), which also covers 2014 to 2023, and are described in [Brelsford et al. 2024, *Scientific Data*](https://doi.org/10.1038/s41597-024-03095-5).

| Record | Contents | Columns |
| --- | --- | --- |
| [OSTI 2500278](https://www.osti.gov/biblio/2500278) (DOI 10.13139/OLCF/2500278), released 2025-04-03 | EAGLE-I Power Outage Data **2024**, county level, 15-minute intervals | `fips_code, county, state, customers_out, run_start_time, total_customers` |
| [OSTI 3012826](https://www.osti.gov/biblio/3012826) (DOI 10.13139/ORNLNCCS/3012826), released 2026-02-19 | EAGLE-I Power Outage Data **2025**, same format | `fips_code, county, state, customers_out, run_start_time` (no `total_customers`) |

- **Coverage:** every U.S. county that has a scraped utility, 2014 to 2025. Times are UTC. Rows with zero customers out are left out, so a missing row means either no outage or a gap in collection. Customer coverage grows over time, and the `DQI.csv` and `coverage_history.csv` files give the data quality by year.
- **Format:** one CSV per year, about 1.2 to 1.4 GB each (2024 is 1.44 GB, 2025 is 1.40 GB). `MCC.csv` gives modeled customers per county (as of 2022), which fills the missing `total_customers` for 2025.
- **License:** CC BY 4.0 on the Figshare copy. The ORNL Constellation pages list no license of their own.
- **Download:** the OSTI and ORNL pages only offer Globus, which needs a login. The same files, 2014 to 2025, are on Figshare with plain HTTPS links: [10.6084/m9.figshare.24237376](https://doi.org/10.6084/m9.figshare.24237376) (for example `https://ndownloader.figshare.com/files/53581661` is 2024 and `.../62164877` is 2025). **The ETL uses Figshare.**
- **Plan impact:** the raw files are too big for the browser. The ETL rolls them up to daily county peak outage (and percent of customers out) as Parquet plus a small GeoJSON per storm, which is what R2 serves. The vulnerability term in the risk model uses each county's historical outage rate from this.
- **Worth a look:** a 2026 *Scientific Data* paper, "A spatiotemporally harmonized dataset of utility-reported power outages and NWS VTEC weather warnings for the contiguous United States (2015 to 2024)", already joins EAGLE-I outages to NWS warnings. It could save ETL work for the storm history view and the v2 model. Not yet checked.

### Grid: HIFLD transmission lines and substations

HIFLD Open, the original public home for this data, has been retired. The three links below are copies of its last public release.

| Source | Status | Contents |
| --- | --- | --- |
| [FWS: US Electric Power Transmission Lines](https://gis-fws.opendata.arcgis.com/datasets/fws::us-electric-power-transmission-lines/about) | **Verified, best source for lines.** Hosted feature service: `https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0` | 94,619 polylines (all U.S. and territories, Web Mercator). Data last edited 2025-08-26, and the newest `SOURCEDATE` is 2024-09-26 |
| [Data Rescue Project: HIFLD Open Transmission Lines](https://portal.datarescueproject.org/datasets/hifld-open-transmission-lines/) | **Verified, backup.** Archived 2025-08-26, 77 MB, downloadable from [DataLumos project 240591](https://www.datalumos.org/datalumos/project/240591/version/V1/view) | The same HIFLD transmission lines feature class/shapefile. Lines only, no substations. DataLumos may need a free ICPSR login, and it blocked our automated fetch |
| [Rutgers HIFLD MapServer](https://oceandata.rad.rutgers.edu/arcgis/rest/services/RenewableEnergy/HIFLD_Electric_SubstationsTransmissionLines/MapServer) | **Not verified.** The server's TLS chain ends at the emSign root, which this build environment does not trust, and a second fetch returned HTTP 503 | By its name, HIFLD substations and lines. It is a MapServer, so feature export may be capped or turned off. It is still the only candidate for **substations**, so check it from a browser before relying on it |

- **FWS fields:** `ID, TYPE` (overhead/underground, AC/DC), `STATUS, OWNER, VOLTAGE` (kV, `-999999` when unknown), `VOLT_CLASS, INFERRED, SUB_1, SUB_2` (end substation names), `SOURCE, SOURCEDATE, VAL_METHOD, VAL_DATE, NAICS_CODE, NAICS_DESC`, and length.
- **Voltage mix:** 44,665 segments at 100 to 161 kV, 30,348 under 100 kV, 7,305 at 220 to 287 kV, 2,602 at 345 kV, 815 at 500 kV, 46 at 735 kV and above, 14 DC, and 8,822 unknown.
- **Formats:** queries return JSON, GeoJSON and PBF, 2,000 features per page, and the service allows Extract. The ETL pages through it once, clips it to CONUS and writes PMTiles to R2. The app does not call the FWS service live.
- **License:** a U.S. government work with an FWS no-warranty disclaimer, and no other restrictions. The UI credits "HIFLD via USFWS".
- **Substations:** the Rutgers service still needs checking. A verified fallback is a community copy of HIFLD substations (77,946 points, see More sources below). Other options are OpenStreetMap `power=substation` (ODbL, needs attribution) or the `SUB_1`/`SUB_2` line endpoints.

### Live weather radar

Nothing is needed from the owner: no key, account or payment. All three options below answered from this environment on 2026-10-20.

| Source | What it is | How the app uses it |
| --- | --- | --- |
| [NOAA MRMS base reflectivity (time-enabled)](https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer) | ArcGIS ImageServer of the national WSR-88D mosaic. Updates every 5 minutes, keeps a 4-hour moving window. CONUS, Alaska, Hawaii, the Caribbean and Guam. Its CORS headers allow `storms.codyparham.com` | **Primary.** An `ImageryLayer` in the SDK, tied to the time slider for a radar loop. Public domain |
| [Iowa Environmental Mesonet NEXRAD tiles](https://mesonet.agron.iastate.edu/ogc/) | Web Mercator XYZ PNG tiles (`/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png`), 5-minute steps, `Access-Control-Allow-Origin: *` | **Fallback** `WebTileLayer` if the NOAA service is down |
| [NOAA nowCOAST WMS](https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows?service=WMS&request=GetCapabilities) | WMS layers for CONUS, Alaska, Hawaii and Caribbean reflectivity mosaics | Second fallback as a `WMSLayer` |

RainViewer's free API also answered, but its free tier is limited and meant for personal use, so it is left out.

### More sources (reachable on 2026-10-20)

| Source | What it gives us | Role |
| --- | --- | --- |
| [NWS watches, warnings and advisories](https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/FeatureServer) | Live polygons as a FeatureServer, next to the [NWS API](https://api.weather.gov/alerts/active) (GeoJSON) | Live alerts layer, no ETL needed |
| [SPC outlooks](https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/FeatureServer) and [Day 1 GeoJSON](https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson) | Day 1 to 8 convective outlooks, also tornado, wind and hail probabilities | Future severe weather |
| [WPC Winter Storm Severity Index](https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer) | Forecast winter storm impact levels | Winter and ice hazard |
| [NDFD temperature](https://mapservices.weather.noaa.gov/raster/rest/services/NDFD/NDFD_temp/MapServer) | Forecast temperature grids | Heat and cold stress. Wind gust and ice still need the NDFD GRIB2 files |
| [NHC CurrentStorms.json](https://www.nhc.noaa.gov/CurrentStorms.json) | Active tropical systems with links to their GIS files | Live hurricanes |
| [IBTrACS v04r01 CSV](https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/) | Global best tracks with wind radii | Past hurricanes |
| [NOAA Storm Events CSV](https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/) | Yearly event, location and fatality files | Past severe storms, joined to EAGLE-I by county and date |
| [NIFC WFIGS current fire perimeters](https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0) | 108 active perimeters on 2026-10-20 | Wildfire hazard and public-safety shutoff context |
| [USGS NWIS instantaneous values](https://waterservices.usgs.gov/nwis/iv/) | Live river gauge heights | Flooding near substations |
| [OpenFEMA Disaster Declarations](https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries) | Declarations by county, type and date | Labels for past storms, and a ground truth for v2 |
| [HIFLD substations (community copy)](https://services6.arcgis.com/OO2s4OoyCZkYJ6oE/arcgis/rest/services/Substations/FeatureServer/0) | 77,946 points with NAME, STATE, COUNTYFIPS, LINES, MAX_VOLT, MIN_VOLT, STATUS. Data dated 2022-02-13 | **Substations fallback** if Rutgers stays down. It is a personal re-upload, so snapshot it to R2 and credit HIFLD |
| FEMA National Risk Index | County and tract risk scores by hazard | Vulnerability term. The download host refused the connection, so not yet checked |

### Reuse from rexplorer-src

The owner's RExplorer project covers Montgomery County, Tennessee, so its data does not cover CONUS. Its pipeline code and Cloudflare setup are reusable as they stand.

- **`pipelines/rexplorer_pipeline/census.py`:** the ACS 5-year extractor (population, households, income, housing, with margins of error) plus LODES jobs. Widen `AREA_COUNTIES` from one county to all states, and request tracts and counties instead of block groups. It uses the `CENSUS_API_KEY` secret, which the owner already has.
- **`arcgis.py`:** pages any ArcGIS feature layer by object-ID ranges and yields GeoJSON in EPSG:4326. It fits the FWS lines, the substations and the fire perimeters.
- **`checks.py`:** a weekly check that every source still answers and still has the expected fields. It fits the many feeds here.
- **`tiles.py` and `apps/tiles-worker` (ADR 0006):** tippecanoe to PMTiles on R2, served by a Cloudflare Worker with CORS locked to the site. This is the same pattern StormX plans for the grid and H3 layers.
- **TIGERweb layers** (counties, tracts, block groups) and **3DEP terrain** reading (`terrain.py`) for the 3D landfall view.

### Other sources (planned, not yet verified)

| Source | What it gives us | Role |
| --- | --- | --- |
| NOAA NHC GIS, IBTrACS, HURDAT2 | Hurricane tracks, wind radii, forecast cones | Past and future hurricanes |
| NOAA Storm Events Database | Tornado, hail, wind, ice, flood events | Past severe storms |
| NDFD / NBM grids | Forecast wind gust, ice, snow, temperature | Main hazard driver |
| Census TIGER + ACS | Boundaries, households, population | Exposure and customer estimates. Reuse the RExplorer extractor |
| HIFLD / EIA-861 service territories | Utility service areas | Who is affected |
| Synthetic | Fictional Gulf Coast utility: feeders, customers, outage tickets | Utility operations demo, labeled "simulated" in the UI |

## Google Maps (free features)

Google's terms forbid showing Google Maps content "with or near a non-Google map" (no Places data on a non-Google map, no Street View on the same screen as one). The main map is ArcGIS, so Google features live in links and on a separate page, never on top of the ArcGIS map. Checked against [Google's pricing](https://developers.google.com/maps/billing-and-pricing/pricing) and [terms](https://cloud.google.com/maps-platform/terms) on 2026-10-20.

| Feature | Cost | How StormX uses it |
| --- | --- | --- |
| [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) | Free, no key, no billing account | "Open in Google Maps" and "Street View here" links in every substation, line and county popup. Opens in a new tab. **Ships in v1** |
| [Maps Embed API](https://developers.google.com/maps/documentation/embed/get-started) | Unlimited free (needs a key and a billing account) | A separate "Street-level" page with an embedded Street View of the selected asset, plus a "satellite now" view. Optional |
| Street View Metadata | Unlimited free | Checks whether imagery exists before showing the Street View link |
| Static Street View | 10,000 free a month | A thumbnail on the Street-level page only (never next to the ArcGIS map) |
| Weather API | 10,000 free a month | **Not used.** Its terms bar using it in an app whose main purpose is weather. NWS covers the same need for free |
| Air Quality API | 10,000 free a month | Optional later: its terms allow "environmental risk indices", which could add wildfire smoke to the risk model |

Every paid Google API needs a Cloud billing account with a card, even inside the free caps, so set a budget alert and per-API quotas if the owner turns on Embed. Maps URLs need neither.

## UI design: frosted glass that follows the weather

A Frutiger Aero take on Apple-style frosted glass. Translucent, glossy panels float over the map, and a light ambient layer behind them reacts to the weather where the visitor is.

**Look**

- Panels: `backdrop-filter: blur(20px) saturate(160%)`, a white tint of 55 to 70% so text keeps WCAG AA contrast, a 1 px inner highlight on the top edge, soft shadows and 16 to 20 px corners. Calcite components are themed through their CSS variables instead of rebuilt.
- Frutiger Aero details: aqua-to-sky-blue and fresh-green gradients, glossy pill buttons with a top shine, gentle bubbles and lens glints, and nature imagery. The risk colors stay a separate, colorblind-safe scale so the theme never changes what the data says.
- Type and motion: SF Pro on Apple devices and Inter elsewhere. Springy 200 to 300 ms transitions.

**Weather where the visitor is**

1. Ask for browser location only when the visitor taps "Match my weather". Without it, use the map's center.
2. Look up the nearest station with `api.weather.gov/points/{lat},{lon}`, then read `/stations/{id}/observations/latest` (`textDescription`, `presentWeather`). The NWS API is free, needs no key, and sends `Access-Control-Allow-Origin: *` (checked 2026-10-20). Refresh every 15 minutes.
3. Work out day or night from the sun's position (calculated in the browser) and the season from the date and latitude.

| Condition | Ambient effect |
| --- | --- |
| Rain or drizzle | Raindrops running down the glass panels, with a light ripple on the panel edges |
| Thunderstorm | Rain plus a rare soft lightning flash (no rapid flashing) |
| Snow or ice | Slow snowflakes and a frosted rim on the panels |
| Clear, day | A warm sunlight glow and lens glint off the panel edges |
| Clear, night | A deep blue gradient with a few twinkling stars |
| Cloudy or fog | Slow drifting cloud wisps and more blur |
| Wind (gusts over 25 mph) | Particles and wisps drift faster at an angle |
| Calm in autumn | Falling leaves |
| Calm in spring | Drifting petals and Aero bubbles |
| Calm in summer | Light sun glow and bubbles |
| Calm in winter | Cool tint and faint frost |

**Rules**

- One canvas layer behind the panels, never over the map data. It stays under 2% of a frame on a mid-range phone, pauses when the tab is hidden, and has fewer particles on mobile.
- `prefers-reduced-motion` and an "Effects off" toggle show a still version of the same theme.
- The weather effect is decoration. Risk, alerts and radar always come from the map layers.
- Planned in Phase 4 (Showcase), with the glass panels themselves in Phase 1.

## Risk model (v1)

A 0 to 100 index per H3 hex (resolution 6 nationally, 8 in the demo region), rolled up to tracts and counties. Each transmission line segment and substation also gets its own score.

- **Hazard (50%):** the worst active hazard in the hex: peak wind gust, hurricane wind radii, ice accretion, snow load, tornado/hail probability, flood depth, red-flag wind, or extreme heat/cold load stress. Each is scaled against an outage threshold.
- **Exposure (30%):** transmission line miles, substation count and voltage class, and households.
- **Vulnerability (20%):** tree canopy, the county's historical outage rate from EAGLE-I, and distance to a substation.
- **v2:** a gradient-boosted model trained on past storms, compared with the index on a backtest page.

## Screens

StormX has a landing page and two map modes. A toggle at the top of the map switches between the modes and keeps the place and time the visitor is looking at.

### Landing page

- The StormX name and a logo (design to be decided later).
- Two large glass buttons: **View radar** and **View outage map**. The choice is remembered for next time.
- Sign in and the About page are linked from here.

### Radar mode

A national weather radar and forecast app.

- **Default view:** the whole U.S. Light and dark modes follow the device setting, with a manual switch. They use the Esri Light Gray and Dark Gray Canvas basemaps and Calcite's light and dark themes.
- **Radar:** the NOAA MRMS loop (last 4 hours, 5-minute steps) with play, pause and a time slider.
- **Overlays:** NWS warnings, watches and advisories; SPC severe outlooks; NHC storms and cones; the winter storm severity index.
- **Forecast button:** opens a glass popup that asks for a ZIP code or "Use my location". It shows current conditions, the next 24 hours and 7 days from the NWS API, plus any active alerts for that point. ZIPs become coordinates through the Census ZCTA Gazetteer file (about 33,000 centroids, kept as a static JSON on R2), so there is no geocoding API or key.
- **Fire:**
    - Active incidents and perimeters from NIFC (the Esri live layer `USA_Wildfires_v1` has both, and WFIGS is the direct source).
    - Satellite hotspots from NASA FIRMS (VIIRS and MODIS, updated about every 3 hours). FIRMS needs a free `MAP_KEY`, so the ETL fetches it and caches it on R2, and the key never reaches the browser.
    - Smoke plumes from the NOAA Hazard Mapping System (daily polygons).
    - Red flag warnings (already in the NWS layer) and the SPC fire weather outlook.
    - The fire popup shows name, size, containment, start date and the last update time.

### Outage risk mode

A closer look at utility outage risk.

- **Default view:** zoomed in on the visitor's location (with permission), a ZIP they type, or a saved place if they are signed in. Without any of these it opens on the Gulf Coast demo region.
- **Layers, grouped in the layer list:**
    - **Current outages:** ORNL ODIN, county, ZIP or polygon counts every 15 minutes (see below).
    - **Power grid:** transmission lines by voltage and substations.
    - **Weather now:** radar, NWS warnings including tornado and severe thunderstorm watches, and fire.
    - **Risk:** the live H3 risk index, and a historical risk heatmap (outage frequency per county from EAGLE-I, 2014 to 2025).
    - **Outage history:** pick a past storm or date range and replay EAGLE-I county outages on the time slider.
    - **Simulated utility:** the fictional Gulf Coast utility's feeders, customers and outage tickets.
- **Real vs. simulated:** every layer is tagged **Real** or **Simulated** in the layer list, the legend and each popup. Simulated layers use a hatched or dashed style and a "Simulated data" ribbon, so the two can't be confused in a screenshot.
- Also here: the asset impact table with CSV export, county popups with the printable PDF, and scenario mode.

### Live outage data: ORNL ODIN

[ODIN](https://odin.ornl.gov/) (Outage Data Initiative Nationwide) collects outage reports that utilities submit to ORNL. Checked on 2026-10-20:

- `https://odin.ornl.gov/odi/status` lists the 157 reporting utilities with their EIA ID, total customers out and the time of the last report. 75 had outages at the time of checking, about 16,700 customers in all.
- `https://odin.ornl.gov/odi/map?scale=COUNTY` (also `STATE`) returns outage areas with the geometry, county FIPS, customers out (`metersOut`), customers served (`metersServed`) and utility name. 131 utilities report by county, 10 by ZIP, 11 by point, 4 by polygon and 1 by H3.
- **Limits:** coverage is only the utilities that take part, not the whole country, so the map says "Reported by participating utilities". These are the endpoints ODIN's own public map uses, and they send no CORS header, so the ETL fetches them every 15 minutes and writes GeoJSON to R2. Before launch, email odin@ornl.gov to confirm that reuse with credit is fine.
- Nationwide live outage sites such as PowerOutage.us are paid and forbid scraping, so they are not used.

### Accounts (free)

Signing in is optional and free. Everything above works without an account.

**What an account adds:**

- Saved places (home, family, work) that open the outage map and the forecast popup in one tap.
- Alerts by email when a saved place gets an NWS warning or its risk reaches High.
- Saved layer setups, plus theme and "Effects off" preferences, synced across devices.

**Recommended setup: Supabase Auth**

- The owner already uses Supabase for RExplorer.
- The free plan covers 50,000 monthly users, and sign-in works from a static GitHub Pages site.
- Sign-in methods: Google, GitHub, and an emailed magic link. There are no passwords to store.
- User data lives in Postgres tables locked by row-level security, so each user can only read their own rows.
- Alert emails go through Resend's free tier (3,000 a month), because Supabase's built-in email is rate limited.
- User management runs from the Supabase dashboard: list users, disable a user, or delete a user. An `is_admin` flag gates the scenario editor.
- Watch-outs: free Supabase projects pause after a week without activity (the ETL Action's ping prevents that), and the free plan allows two projects (RExplorer uses one).
- Alternatives:
    - **Firebase Auth:** also free at this scale and never pauses, but it means a second backend.
    - **Clerk:** polished sign-in screens, 10,000 monthly users free.
- Privacy: store only the email, display name and saved places. Add a "Delete my account" button and a short privacy page.

**Also on the site**

- The weather-reactive glass UI on all screens.
- One 3D landfall view.
- The About page covering methods, data lineage and architecture.

## Roadmap

1. **Foundation:** the repo, Pages with the custom domain, the R2 bucket with CORS, the ArcGIS key and basemaps, the landing page, the mode toggle, glass panels, and light and dark modes.
2. **Radar mode:** the MRMS radar loop, NWS alerts, SPC and NHC layers, the forecast popup with ZIP or location, and the fire layers.
3. **Outage risk mode:** grid layers, ODIN current outages, the EAGLE-I history and heatmap, the ETL Action, the H3 risk layer, county popups, and the simulated utility with Real and Simulated tags.
4. **Accounts:** sign-in, saved places, saved layer setups, and email alerts.
5. **Showcase:** scenario mode, the ML model and backtest, the 3D view, the weather-reactive effects, the logo, the About page, and mobile polish.

## Setup steps (owner)

- [ ] Create the R2 bucket `stormx-data`.
- [ ] Connect the custom domain `data.codyparham.com` to the bucket.
- [ ] Add a CORS rule that allows GET from `https://storms.codyparham.com` and `http://localhost:5173`.
- [ ] Create an R2 API token (Object Read & Write, this bucket only) and add these repo Actions secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- [ ] Create an ArcGIS Location Platform API key with basemap access only, restricted by referrer to `storms.codyparham.com` and `localhost`.
- [ ] Add a Cloudflare DNS CNAME `storms` that points to `codyparham94.github.io` with the proxy off, then set the custom domain in the repo's Pages settings.
- [ ] Register for a free NASA FIRMS `MAP_KEY` (firms.modaps.eosdis.nasa.gov/api/map_key) and add it as the `FIRMS_MAP_KEY` Actions secret.
- [ ] Pick the login provider (Supabase recommended). For Supabase, create the project and add Google and GitHub OAuth apps. For alert emails, make a free Resend account.
- [ ] Email odin@ornl.gov to confirm StormX may show ODIN outage data with credit.
