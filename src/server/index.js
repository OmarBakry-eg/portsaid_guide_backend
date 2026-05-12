// HTTP API exposing the same endpoints SerpApi has, served by our own
// scraper. Now with pagination + image-proxy.
//
//   GET /place?place_id=ChIJ...                    → place_results
//   GET /reviews?data_id=...&next_page_token=...   → paginated reviews
//   GET /photos?data_id=...&next_page_token=...    → paginated photos
//   GET /places?category=coffee&sort=rating        → bulk feed
//   GET /img?u=<url>                               → image proxy (CDN bypass)
//   GET /healthz

import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { scrapePlaceDetails } from '../scrapers/place-details.js';
import { scrapeReviews } from '../scrapers/reviews.js';
import { scrapePhotos } from '../scrapers/photos.js';
import { getCached, setCached } from './cache.js';
import { imgProxyHandler } from './img-proxy.js';
import { CACHE_TTL_MS, SERVER_PORT, API_BASE_URL, rewriteProxyUrls } from '../config.js';
import { uploadOnePlace } from '../pipeline/firestore.js';

const STORE_PATH = new URL('../../data/places.json', import.meta.url).pathname;
const REVIEWS_PER_PAGE = 8;
const PHOTOS_PER_PAGE = 20;

const app = express();
app.disable('x-powered-by');

// ----- /img — image proxy (registered FIRST so nothing shadows it) -----
app.get('/img', (req, res, next) => {
  Promise.resolve(imgProxyHandler(req, res)).catch(next);
});

// JSON responses get rewritten so any stored `localhost:OLDPORT/img?u=` URLs
// are rebased to the current API_BASE_URL. Cheap; runs on every response.
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(rewriteProxyUrls(body));
  next();
});

// ----- Store reader (auto-refresh on file mtime change) -----
let storeCache = { mtime: 0, places: {}, byDataId: {} };
async function loadStore() {
  if (!existsSync(STORE_PATH)) return storeCache;
  const { default: fs } = await import('node:fs');
  const stat = fs.statSync(STORE_PATH);
  if (stat.mtimeMs <= storeCache.mtime) return storeCache;
  const raw = await readFile(STORE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const byDataId = {};
  for (const p of Object.values(parsed.places ?? {})) {
    if (p.data_id) byDataId[p.data_id] = p;
  }
  storeCache = { mtime: stat.mtimeMs, places: parsed.places ?? {}, byDataId };
  return storeCache;
}

// ----- Inflight dedup so two concurrent identical requests share work -----
const inflight = new Map();
async function withCache(kind, key, fn) {
  const ttl = CACHE_TTL_MS[kind];
  const hit = await getCached(kind, key, ttl);
  if (hit) return { ...hit.data, _cached_age_ms: hit.age_ms };
  if (inflight.has(key)) return inflight.get(key);
  const work = (async () => {
    const data = await fn();
    await setCached(kind, key, data);
    return data;
  })();
  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}

// ----- Pagination helpers -----
// We use a tiny base64 token instead of Google's monstrous cursor. The token
// just encodes `{offset:N}` so server is stateless and the app can navigate
// forward and backward freely.
function encodeToken(offset) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}
function decodeToken(token) {
  if (!token) return { offset: 0 };
  try {
    const obj = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    return { offset: Math.max(0, parseInt(obj.offset || 0, 10)) };
  } catch {
    return { offset: 0 };
  }
}
function paginate(items, perPage, token, dataId, hl) {
  const { offset } = decodeToken(token);
  const slice = items.slice(offset, offset + perPage);
  const nextOffset = offset + perPage;
  const hasMore = nextOffset < items.length;
  const next_page_token = hasMore ? encodeToken(nextOffset) : undefined;
  const next = hasMore
    ? `${API_BASE_URL}/${dataId ? 'photos' : 'reviews'}` +
      `?data_id=${encodeURIComponent(dataId)}&hl=${hl}&next_page_token=${next_page_token}`
    : undefined;
  return { slice, next_page_token, next, total: items.length, offset };
}

// ----- /place -----
app.get('/place', async (req, res) => {
  const place_id = req.query.place_id;
  const hl = req.query.hl || 'en';
  if (typeof place_id !== 'string' || !place_id) {
    return res.status(400).json({ error: 'place_id query parameter is required' });
  }
  const t0 = Date.now();
  const store = await loadStore();
  const fromStore = store.places[place_id];

  if (fromStore && req.query.force !== '1') {
    const place_results = { ...fromStore };
    delete place_results.last_scrape_run_id;
    res.json({
      search_metadata: {
        status: 'Success',
        source: 'store',
        last_scraped_at: fromStore.last_scraped_at,
        total_time_taken: (Date.now() - t0) / 1000,
      },
      search_parameters: { engine: 'google_maps', place_id, hl },
      place_results,
    });
    return;
  }

  try {
    const data = await withCache('place', `${place_id}__${hl}`, () =>
      scrapePlaceDetails({ place_id, hl })
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ----- /reviews (paginated) -----
app.get('/reviews', async (req, res) => {
  const data_id = req.query.data_id;
  const hl = req.query.hl || 'en';
  const token = req.query.next_page_token;
  if (typeof data_id !== 'string' || !data_id) {
    return res.status(400).json({ error: 'data_id query parameter is required' });
  }

  // Always load the FULL list (from store if available, otherwise live
  // scrape). The pagination layer below slices it. This ensures the same
  // full list is used across all pages of the same data_id.
  const cacheKey = `${data_id}__${hl}`;
  const force = req.query.force === '1';
  const store = await loadStore();
  const fromStore = store.byDataId[data_id];

  let fullEnvelope;
  if (fromStore?.reviews_data?.length && !force) {
    fullEnvelope = {
      search_metadata: {
        status: 'Success',
        source: 'store',
        last_scraped_at: fromStore.last_scraped_at,
      },
      search_parameters: { engine: 'google_maps_reviews', data_id, hl },
      place_info: {
        title: fromStore.title,
        address: fromStore.address,
        rating: fromStore.rating,
        reviews: fromStore.reviews,
        type: fromStore.type,
      },
      reviews: fromStore.reviews_data,
    };
  } else {
    try {
      fullEnvelope = await withCache('reviews', cacheKey, () =>
        scrapeReviews({ data_id, hl, max: 200 })
      );
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  const { slice, next_page_token, total, offset } = paginate(
    fullEnvelope.reviews ?? [],
    REVIEWS_PER_PAGE,
    token,
    null,
    hl
  );

  res.json({
    ...fullEnvelope,
    reviews: slice,
    serpapi_pagination: next_page_token
      ? {
          next: `${API_BASE_URL}/reviews?data_id=${encodeURIComponent(data_id)}&hl=${hl}&next_page_token=${next_page_token}`,
          next_page_token,
        }
      : undefined,
    page_info: {
      offset,
      page_size: REVIEWS_PER_PAGE,
      total_in_cache: total,
    },
  });
});

// ----- /photos (paginated) -----
app.get('/photos', async (req, res) => {
  const data_id = req.query.data_id;
  const hl = req.query.hl || 'en';
  const token = req.query.next_page_token;
  if (typeof data_id !== 'string' || !data_id) {
    return res.status(400).json({ error: 'data_id query parameter is required' });
  }

  const cacheKey = `${data_id}__${hl}`;
  const force = req.query.force === '1';
  const store = await loadStore();
  const fromStore = store.byDataId[data_id];

  let fullEnvelope;
  if (fromStore?.photos_data?.length && !force) {
    fullEnvelope = {
      search_metadata: {
        status: 'Success',
        source: 'store',
        last_scraped_at: fromStore.last_scraped_at,
      },
      search_parameters: { engine: 'google_maps_photos', data_id, hl },
      photos: fromStore.photos_data,
    };
  } else {
    try {
      fullEnvelope = await withCache('photos', cacheKey, () =>
        scrapePhotos({ data_id, hl, max: 200 })
      );
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  const { slice, next_page_token, total, offset } = paginate(
    fullEnvelope.photos ?? [],
    PHOTOS_PER_PAGE,
    token,
    data_id,
    hl
  );

  res.json({
    ...fullEnvelope,
    photos: slice,
    serpapi_pagination: next_page_token
      ? {
          next: `${API_BASE_URL}/photos?data_id=${encodeURIComponent(data_id)}&hl=${hl}&next_page_token=${next_page_token}`,
          next_page_token,
        }
      : undefined,
    page_info: {
      offset,
      page_size: PHOTOS_PER_PAGE,
      total_in_cache: total,
    },
  });
});

// Normalise a user-supplied category string to one of our canonical slugs.
// Accepts singular/plural ("restaurant"/"restaurants"), with-or-without
// hyphens ("gas-station"/"gas_station"/"gas station"), case-insensitively.
function normalizeCategory(raw, available) {
  if (typeof raw !== 'string' || !raw) return null;
  const norm = raw.toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  if (available.has(norm)) return norm;
  const singular = norm.replace(/s$/, '');
  if (available.has(singular)) return singular;
  const plural = `${norm}s`;
  if (available.has(plural)) return plural;
  // Substring match as a last resort ("restaurants" → "restaurant", etc.)
  for (const slug of available) {
    if (slug.includes(norm) || norm.includes(slug)) return slug;
  }
  return null;
}

// ----- /categories — what's actually in the store, with counts -----
app.get('/categories', async (_req, res) => {
  const store = await loadStore();
  const counts = new Map();
  const lastScraped = new Map();
  for (const p of Object.values(store.places)) {
    for (const slug of p.source_categories ?? []) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
      const t = p.last_scraped_at;
      if (t && (!lastScraped.has(slug) || t > lastScraped.get(slug))) {
        lastScraped.set(slug, t);
      }
    }
  }
  const list = [...counts.entries()]
    .map(([slug, count]) => ({ slug, count, last_scraped_at: lastScraped.get(slug) }))
    .sort((a, b) => b.count - a.count);
  res.json({ total_categories: list.length, categories: list });
});

// ----- /places — bulk feed for app list views -----
app.get('/places', async (req, res) => {
  const store = await loadStore();
  const rawCategory = req.query.category;
  const sort = req.query.sort || 'rating';

  // Build the set of category slugs actually present in the store.
  const available = new Set();
  for (const p of Object.values(store.places)) {
    for (const slug of p.source_categories ?? []) available.add(slug);
  }

  let list = Object.values(store.places);
  let resolvedCategory;
  if (typeof rawCategory === 'string' && rawCategory) {
    resolvedCategory = normalizeCategory(rawCategory, available);
    if (resolvedCategory) {
      list = list.filter((p) => p.source_categories?.includes(resolvedCategory));
    } else {
      return res.status(404).json({
        error: `unknown category "${rawCategory}"`,
        available_categories: [...available].sort(),
        hint: 'use GET /categories to see what is in the store',
      });
    }
  }
  list.sort((a, b) => {
    if (sort === 'reviews') return (b.reviews ?? 0) - (a.reviews ?? 0);
    if (sort === 'recent') return new Date(b.last_changed_at) - new Date(a.last_changed_at);
    return (b.rating ?? 0) - (a.rating ?? 0);
  });
  res.json({
    count: list.length,
    category: resolvedCategory,
    last_scraped_at: list[0]?.last_scraped_at,
    places: list,
  });
});

// ----- /refresh — on-demand single-place re-scrape, then Firestore push -----
// Called by the Flutter app when a user opens a place detail screen. If the
// stored copy is older than `min_age` minutes (default 30), the server fires
// a live scrape and pushes the result to Firestore. The app's snapshot stream
// receives the updated doc within seconds.
//
// Behaviour:
//   - Returns immediately if the place is fresh enough (HTTP 200, status:'fresh')
//   - Otherwise fires the scrape in the background and returns HTTP 202
//     (the app keeps its existing data and waits for Firestore push).
app.post('/refresh', async (req, res) => {
  const place_id = req.query.place_id;
  const minAgeMinutes = parseInt(req.query.min_age || '30', 10);
  if (typeof place_id !== 'string' || !place_id) {
    return res.status(400).json({ error: 'place_id query parameter is required' });
  }

  const store = await loadStore();
  const existing = store.places[place_id];
  const ageMs = existing?.last_scraped_at
    ? Date.now() - new Date(existing.last_scraped_at).getTime()
    : Infinity;

  if (ageMs < minAgeMinutes * 60_000) {
    return res.json({
      status: 'fresh',
      place_id,
      last_scraped_at: existing.last_scraped_at,
      age_minutes: Math.round(ageMs / 60_000),
    });
  }

  // Fire-and-forget background scrape. The app keeps showing cached data and
  // its Firestore listener will pick up the fresh doc.
  res.status(202).json({
    status: 'refreshing',
    place_id,
    age_minutes: ageMs === Infinity ? null : Math.round(ageMs / 60_000),
  });

  (async () => {
    const t0 = Date.now();
    try {
      const result = await scrapePlaceDetails({ place_id, hl: 'en' });
      const fresh = result.place_results;
      if (!fresh?.place_id) return;
      // Merge with existing record so we don't drop fields the detail
      // scrape doesn't include (source_categories, source_anchors, etc.).
      const merged = {
        ...existing,
        ...fresh,
        last_scraped_at: new Date().toISOString(),
        source_categories: existing?.source_categories ?? [],
        source_anchors: [...new Set([...(existing?.source_anchors ?? []), 'on-demand'])],
      };
      // Best-effort: persist locally too so subsequent reads see it. On
      // hosts with an ephemeral filesystem (Render free tier, Cloud Run)
      // this fails harmlessly — Firestore is the source of truth.
      try {
        const localStorePath =
            new URL('../../data/places.json', import.meta.url).pathname;
        const cur = existsSync(localStorePath)
            ? JSON.parse(await readFile(localStorePath, 'utf8'))
            : { places: {} };
        cur.places[place_id] = merged;
        await writeFile(localStorePath, JSON.stringify(cur, null, 2));
      } catch (e) {
        // Likely a read-only / missing directory — Firestore push below is
        // still the canonical update.
      }

      // Push to Firestore (if configured). Silently no-op if creds missing —
      // we still updated the local store, which the app reads via /places.
      try {
        await uploadOnePlace(merged);
        console.log(
          `${new Date().toISOString()}  refresh  ${place_id.slice(0, 30)}  ok  ${Date.now() - t0}ms  → Firestore`
        );
      } catch (e) {
        console.log(
          `${new Date().toISOString()}  refresh  ${place_id.slice(0, 30)}  local-only (${e.message})`
        );
      }
    } catch (e) {
      console.error(`✗ refresh failed for ${place_id}:`, e.message);
    }
  })();
});

app.get('/healthz', async (_req, res) => {
  const store = await loadStore();
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    store_places: Object.keys(store.places).length,
  });
});

// Bind explicitly to 0.0.0.0 — Render (and most container hosts) require the
// process to listen on all interfaces, not just localhost.
app.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log(`◆ scraper API on http://0.0.0.0:${SERVER_PORT}`);
  console.log(`  GET /place?place_id=ChIJ...`);
  console.log(`  GET /reviews?data_id=0x...:0x...&next_page_token=...`);
  console.log(`  GET /photos?data_id=0x...:0x...&next_page_token=...`);
  console.log(`  GET /places?category=coffee&sort=rating`);
  console.log(`  GET /img?u=<google-image-url>           (proxies the 429-prone CDN)`);
  console.log(`  flags: &force=1 (bypass cache+store), &hl=ar (language)`);
});
