# StormX

Utility Risk Storm Assessment Map

A map of past and forecast U.S. storms, scored for the risk of utility outages. It is built with the ArcGIS Maps SDK for JavaScript and Calcite, hosted on GitHub Pages at [stormx.codyparham.com](https://stormx.codyparham.com), and reads its data from Cloudflare R2 through a small Worker.

See [docs/PLAN.md](docs/PLAN.md) for the project plan.

## Run it locally

```sh
npm ci
npm run dev        # http://localhost:5173
npm test
npm run build

# ETL (Python 3.12+)
cd etl && pip install -e ".[dev]" && pytest -q
python -m stormx_etl.fire out   # FIRMS_MAP_KEY in the environment for hotspots
python -m stormx_etl.zcta out
```

Without `VITE_ARCGIS_API_KEY` the map falls back to Esri's keyless canvas tiles. To use the real basemaps, put the key in `.env.local` (ignored by git):

```sh
VITE_ARCGIS_API_KEY=...
```

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `src/` | The site: landing page, Radar and Outage risk modes, glass UI, light and dark mode |
| `etl/` | Python ETL (FIRMS hotspots, HMS smoke, ZIP centroids) that writes the files R2 serves |
| `scripts/upload-r2.sh` | Uploads an ETL output folder to R2 with the right content types |
| `workers/data/` | Cloudflare Worker that serves the private `stormx-data` bucket read-only, with CORS for the site |
| `.github/workflows/ci.yml` | Typecheck, tests and build for the site and the Worker |
| `.github/workflows/deploy.yml` | Builds the site and publishes it to GitHub Pages (Source: GitHub Actions) |
| `.github/workflows/data-worker.yml` | Deploys the data Worker once `CLOUDFLARE_API_TOKEN` is set |
| `.github/workflows/etl-live.yml` | Every 3 hours: fire hotspots and smoke to `live/fire/` |
| `.github/workflows/etl-static.yml` | Monthly: ZIP code centroids to `static/zcta.json` |
| `.github/workflows/setup-check.yml` | Checks the setup steps in the plan without printing any secret |

## Configuration

| Name | Kind | Used by |
| --- | --- | --- |
| `ARCGIS_API_KEY` | secret | Site build (basemaps; referrer-restricted, so public by design) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | variables | Site build (accounts, Phase 4) |
| `DATA_BASE_URL` | variable | Site build: the data Worker's workers.dev URL |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | secrets | ETL uploads |
| `CLOUDFLARE_API_TOKEN` | secret | Data Worker deploy |
| `FIRMS_MAP_KEY` | secret | ETL (fire hotspots) |
