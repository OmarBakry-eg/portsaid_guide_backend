# portsaid-gmaps-scraper

A Node.js scraper that returns Google Maps search results in **SerpApi's exact
schema**, without paying SerpApi. Designed to feed the Port Said city-guide app
with periodically refreshed place data.

## 🚀 Deployment status

| Component | Where | URL |
|---|---|---|
| **Scheduled scraper** | GitHub Actions (every 6h at `:17` UTC) | [Actions tab](https://github.com/OmarBakry-eg/portsaid_guide_backend/actions) |
| **HTTP API server** | Render Web Service (free tier) | https://portsaid-guide-backend.onrender.com |
| **Place store** | Firestore (`port-said-guide` project, `places` collection) | — |
| **Mobile app** | Flutter (iOS + Android) reading Firestore in real time | — |

### Health check

```sh
curl https://portsaid-guide-backend.onrender.com/healthz
# → {"ok":true,"ts":"…","store_places":N}
```

> The Render free plan sleeps after 15 min of inactivity. First request after
> a long pause takes ~30s while the container wakes up. Subsequent requests
> are sub-second.

## What it does

Given a search query and a map center (`lat,lon,zoom`), it:

1. Drives a headless Chromium via Playwright to `google.com/maps/search/...`
2. Captures Google's internal `pb`-encoded XHR responses (the same payload
   SerpApi parses)
3. Clicks each result to fire Google's per-place detail XHR, which returns the
   rich data (price, extensions, user-review snippet, etc.)
4. Merges all captures, deduplicating by `place_id` and keeping the richest
   copy of each place
5. Emits a JSON file with a `local_results` array shaped identically to
   SerpApi's `engine=google_maps&type=search` response

## Output schema

Each place in `local_results` includes:

- `position`, `title`, `place_id`, `data_id`, `data_cid`, `provider_id`
- `gps_coordinates` (`{latitude, longitude}`)
- `rating`, `reviews`
- `price`, `extracted_price` (when present)
- `type`, `types`, `type_id`, `type_ids`
- `address`
- `operating_hours` (per-day map), `open_state` ("Open · Closes 2 AM")
- `phone`, `website`
- `extensions` (atmosphere, crowd, payments, amenities, etc.)
- `service_options` (`{dine_in, delivery, takeout, ...}`)
- `user_review` (featured snippet)
- `thumbnail`
- SerpApi-style helper URLs: `reviews_link`, `photos_link`, `place_id_search`

## Install

```sh
cd scraper
npm install
npx playwright install chromium
```

## Run

```sh
node src/index.js --q=coffee --ll=@31.2653,32.3019,15.1z --out=output/coffee.json
```

Options:

| Flag | Default | Notes |
|---|---|---|
| `--q=<text>` | required | Search query, e.g. `coffee`, `pharmacy`, `restaurant` |
| `--ll=@lat,lon,zoom` | required | Map center + zoom, exactly like SerpApi |
| `--hl=en` | `en` | Display language |
| `--out=path.json` | derived from `q` | Where to write the SerpApi-shaped JSON |
| `--raw=dir` | off | Also dump raw captured XHR bodies — useful for parser debugging |
| `--headful` | off | Show the browser window |

## Coverage on the sample query (`coffee` @ Port Said)

On 20 top results, fields populated:

| Field | Coverage | Note |
|---|---|---|
| title, place_id, data_id, data_cid, provider_id, gps_coordinates, rating, reviews, type/types, address, extensions | 20/20 | Always present |
| user_review, operating_hours, open_state, thumbnail | 18/20 | Some places lack the data on Google's side |
| phone | 16/20 | Many small cafés don't list phone |
| service_options | 12/20 | Only present for places offering dine-in/delivery/etc. |
| price, extracted_price | 11/20 | Only present where Google has a price tag |
| website | 8/20 | Many places have no website |

Coverage below 20 reflects what Google actually stores for each place, not
parser gaps — SerpApi shows the same omissions for the same places.

## Architecture

```
src/
  index.js           CLI entry — parses args, calls scrape(), writes JSON
  scrape.js          Playwright orchestration: navigate → scroll → click → capture
  parse-only.js      Replay-mode: re-parse saved raw captures without re-scraping
                     (used during parser development; useful for retroactive
                     re-shaping if SerpApi adds a new field)
  parsers/
    place.js         Maps Google's pb-encoded place tuple → SerpApi schema
  util/
    args.js          --flag=value CLI parser
    pb.js            Strips Google's `)]}'` prefix and chunked-wrapper format,
                     plus helpers for safe nested-array access
```

## How it talks to Google (and the brittleness this implies)

The scraper does NOT use any public Google API. It reads Google Maps' internal
`pb`-encoded responses, which:

- Are **undocumented** — index positions are reverse-engineered
- Change **a few times per year** — when Google shifts indices, fields silently
  go missing. Re-run with `--raw=raw/` and the `parse-only.js` replay tool to
  find the new index for that field
- May trigger **rate limiting** if used aggressively — keep cadence low and
  consider rotating IPs for higher volume

The parser at `src/parsers/place.js` documents every index it reads. If a field
breaks, the comments there tell you where to look.

## Multi-category orchestration

The `run-all` command scrapes every (category × anchor) pair on a cadence
schedule, deduplicates by `place_id`, and writes a single JSON store with
freshness metadata:

```sh
# Run only the categories that are due for refresh
node src/run-all.js

# Force a full refresh of all categories
node src/run-all.js --force

# Refresh just coffee + restaurants
node src/run-all.js --only=coffee,restaurant
```

Configuration:

- `config/anchors.json` — geographic search centers covering Port Said + Port Fouad
- `config/categories.json` — what queries to run, with per-category `cadence_hours`
  (e.g. coffee=6h, hotel=24h, mosque=168h since they rarely change)

Each place document in the store gets enriched with:

```js
{
  ...all SerpApi fields...,
  source_categories: ["restaurant", "fish-seafood"],    // which queries surfaced it
  source_anchors:    ["city-center", "port-fouad"],     // which anchors saw it
  first_seen_at:     "2026-05-11T10:00:00.000Z",
  last_seen_at:      "2026-05-12T16:00:00.000Z",
  last_scraped_at:   "2026-05-12T16:00:00.000Z",
  last_changed_at:   "2026-05-12T10:00:00.000Z",        // when rating/reviews changed
  previous_rating:   4.7,                               // pre-change values for "newly rated" UX
  previous_reviews:  115,
  last_scrape_run_id: "run-2026-05-12T16-00-00-000Z"
}
```

## Storage: Firestore

For production, push the store to Firestore so the Flutter app can read it
directly with real-time updates.

Setup:

```sh
npm install firebase-admin
export FIRESTORE_PROJECT=portsaid-guide-prod
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
node src/export-firestore.js
```

Firestore layout:

```
places/{place_id}              → full document, queryable by source_categories, rating, etc.
places/{place_id}/snapshots/.. → time-series of (rating, reviews) for trend display
runs/{run_id}                  → scrape run telemetry (jobs ok/err, durations)
```

## Local HTTP API server

The scraper ships a tiny Express server so the Flutter app can fetch data
through endpoints that mirror SerpApi's shape, but back to OUR scraper.

```sh
npm run server
# ◆ scraper API on http://localhost:8080
```

Endpoints:

| Endpoint | Returns | Source |
|---|---|---|
| `GET /place?place_id=ChIJ...` | full place document (matches SerpApi `place_results`) | store → live scrape fallback |
| `GET /reviews?data_id=0x...:0x...` | reviews list (matches SerpApi `google_maps_reviews`) | store → live scrape fallback |
| `GET /photos?data_id=0x...:0x...` | photo URLs (thumbnail + full-res, matches SerpApi `google_maps_photos`) | store → live scrape fallback |
| `GET /places?category=coffee&sort=rating` | bulk feed for the app's main list view | store |
| `GET /healthz` | `{ok, store_places}` | — |

Flags on every endpoint:
- `&hl=ar` — language (default `en`)
- `&force=1` — bypass store and disk cache, always live-scrape

The `reviews_link`, `photos_link`, `place_id_search` URLs that appear in
scrape output now point to **your own server** (configured via
`API_BASE_URL`, default `http://localhost:8080`). The Flutter app calls them
as-is; SerpApi is never involved.

### How the endpoints stay fast

The Express server reads from `data/places.json` first — that's the store
the orchestrator populates every 6 hours. Store hits return in **~1ms**.
If a place isn't in the store, the server falls back to a live Playwright
scrape (~5s) and caches the result to disk for the next request.

Configure the response freshness via env:

```sh
export API_BASE_URL=https://api.portsaid.app
export PORT=8080
```

## Current production deployment

```
┌─────────────────────────────┐  every 6h  ┌─────────────────────────┐
│ GitHub Actions              │ ─────────▶ │ Headless Chromium runner │
│ .github/workflows/scrape.yml│            │ scrapes Google Maps      │
└─────────────────────────────┘            │ writes places.json       │
                                           │ pushes to Firestore      │
                                           └────────────┬─────────────┘
                                                        ▼
┌─────────────────────────────┐            ┌─────────────────────────┐
│ Render Web Service          │ on-demand  │ Firestore               │
│ portsaid-guide-backend      │ ────────▶  │ port-said-guide/places  │
│ /refresh /img /place /…     │            │ (1,786 docs)            │
└─────────────────────────────┘            └────────────┬─────────────┘
        ▲                                                │ real-time
        │ POST /refresh                                  │
        │ when user opens                                ▼
        │ a place's detail            ┌─────────────────────────┐
        │                             │ Flutter app             │
        └─────────────────────────────┤ cloud_firestore SDK     │
                                      └─────────────────────────┘
```

### Render service config (already set)

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install && npx playwright install chromium` |
| Start command | `node src/server/index.js` |
| Health check path | `/healthz` |
| Env: `FIRESTORE_PROJECT` | `port-said-guide` |
| Env: `GOOGLE_APPLICATION_CREDENTIALS` | `/etc/secrets/firebase-service-account.json` |
| Env: `PLAYWRIGHT_BROWSERS_PATH` | `0` |
| Env: `API_BASE_URL` | `https://portsaid-guide-backend.onrender.com` |
| Secret file | `/etc/secrets/firebase-service-account.json` (Firebase Admin SDK JSON) |

If the Node runtime ever fails to launch Chromium (missing system libs), the
repo also ships a [`Dockerfile`](./Dockerfile) that uses Microsoft's official
Playwright image with every apt dependency pre-installed. Switch Render's
runtime from Node to Docker in the service settings — no other changes needed.

### GitHub Actions (cron)

The scheduled scrape is configured in
[`.github/workflows/scrape.yml`](.github/workflows/scrape.yml). It needs one
secret in the repo settings:

- `FIREBASE_SERVICE_ACCOUNT` — full JSON contents of the Firebase Admin
  service-account key.

### Cost reality

Both Render (web service) and GitHub Actions (cron) are on free tiers:

- **Render free**: 750 service hours/month — auto-sleeps after 15 min idle
  so we use far less. First request after sleep adds ~30s cold-start.
- **GitHub Actions free**: 2,000 minutes/month for private repos. Our 4×/day
  × ~30 min runs ≈ 60 h/month, well within budget.
- **Firestore free**: 50,000 reads/day, 20,000 writes/day. A city-guide
  with ~1,800 places hits ~2k writes per cron run and the app reads cached
  data, so we stay well below the quota.

Total monthly cost: **$0**.

## Flutter integration sketch

```dart
// Read every restaurant, sorted by rating
FirebaseFirestore.instance
  .collection('places')
  .where('source_categories', arrayContains: 'restaurant')
  .orderBy('rating', descending: true)
  .snapshots()
  .listen((snapshot) {
    final places = snapshot.docs.map((d) => Place.fromJson(d.data())).toList();
    // ... render
  });

// "Open now" — computed client-side from operating_hours, no extra fetch
bool isOpenNow(Map<String, String> operatingHours) {
  final dow = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][DateTime.now().weekday % 7];
  final spec = operatingHours[dow];
  if (spec == null) return false;
  if (spec == 'Open 24 hours') return true;
  // ... parse "8 AM–1 AM"
}

// "Recently updated" badge — anything within the last 24h
final isFresh = place.lastScrapedAt.isAfter(DateTime.now().subtract(Duration(days: 1)));
```

## Freshness UX in the app

The schema enables several "live data" UI affordances:

- **"Updated 4h ago"** badge — `now - last_scraped_at`
- **"Rating ↑ from 4.6 to 4.8"** — `previous_rating` vs `rating`
- **"New this week"** — `now - first_seen_at < 7d`
- **"Trending"** — sort by `(reviews - previous_reviews)` desc

## Legal note

This scraper hits Google Maps directly, which violates Google's Terms of
Service (a civil/contract issue, not a criminal one — see the hiQ v.
LinkedIn ruling). For zero-risk production usage, swap the scraping engine
in `src/scrape.js` for the Google Places API — the output schema can stay
identical so nothing else changes.
