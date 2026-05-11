import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseGoogleResponse, findArray, pick } from './util/pb.js';
import { parsePlace } from './parsers/place.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function buildMapsUrl({ q, ll, hl = 'en' }) {
  // SerpApi-style: https://www.google.com/maps/search/{q}/@{lat,lon,zoom}/?hl=en
  const enc = encodeURIComponent(q);
  return `https://www.google.com/maps/search/${enc}/${ll}/?hl=${hl}`;
}

// A captured response from Google's internal search/preview endpoint.
function isResultsXhr(url) {
  return (
    /\/search\?[^ ]*tbm=map/.test(url) ||
    /\/maps\/preview\/search\?/.test(url) ||
    /\/maps\/rpc\/search\?/.test(url) ||
    /\/maps\/_\/rpc\//.test(url) ||
    // Per-place detail endpoint — returns rich data for a single place_id.
    /\/maps\/preview\/place\?/.test(url) ||
    /\/maps\/preview\/entitylist\?/.test(url)
  );
}

// Walk the parsed pb array to find the list of result entries.
//
// We handle two response shapes:
//   - Search list: `root[64]` is an array of `[null, place_array]`.
//   - Single place (from `/maps/preview/place`): `root[6]` is the place_array
//     directly. We wrap it as a singleton tuple so downstream code is uniform.
function findResultList(root) {
  const isResultTuple = (el) =>
    Array.isArray(el) && Array.isArray(el[1]) && typeof el[1][11] === 'string';

  // (A) Search-list shape.
  const listCandidates = [
    pick(root, 64),
    pick(root, 65),
    pick(root, 63),
    findArray(root, (node) =>
      Array.isArray(node) && node.length > 1 && node.every(isResultTuple)
    ),
  ];
  let best = [];
  for (const c of listCandidates) {
    if (!Array.isArray(c)) continue;
    const filtered = c.filter(isResultTuple);
    if (filtered.length > best.length) best = filtered;
  }
  if (best.length) return best;

  // (B) Single-place shape — the place_array is directly under root.
  const singleCandidates = [pick(root, 6), pick(root, 0), pick(root, 1)];
  for (const c of singleCandidates) {
    if (Array.isArray(c) && typeof c[11] === 'string') return [[null, c]];
  }
  return [];
}

export async function scrape({
  q,
  ll,
  hl = 'en',
  maxScrolls = 30,
  hoverEach = true,
  headful = false,
  rawDir,
}) {
  const url = buildMapsUrl({ q, ll, hl });
  const startedAt = new Date();

  const browser = await chromium.launch({ headless: !headful });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: hl === 'en' ? 'en-US' : hl,
    timezoneId: 'Africa/Cairo',
  });
  const page = await context.newPage();

  const captures = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (!isResultsXhr(u)) return;
    try {
      const text = await resp.text();
      if (!text || text.length < 100) return;
      captures.push({ url: u, text });
    } catch {
      /* response body unavailable — ignore */
    }
  });

  let navError;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    navError = e;
  }

  await page
    .waitForSelector('[role="feed"], div[aria-label*="Results"]', { timeout: 30000 })
    .catch(() => {});

  // Scroll the feed until either we've hit `maxScrolls` or three consecutive
  // scrolls yielded no new feed height — that's how Google signals "end of
  // results" for this area+query.
  let prevHeight = 0;
  let stableScrolls = 0;
  for (let i = 0; i < maxScrolls && stableScrolls < 3; i++) {
    const height = await page.evaluate(() => {
      const feed = document.querySelector('[role="feed"]');
      if (!feed) return 0;
      feed.scrollBy(0, feed.scrollHeight);
      return feed.scrollHeight;
    });
    if (height === prevHeight) stableScrolls += 1;
    else stableScrolls = 0;
    prevHeight = height;
    await page.waitForTimeout(900 + Math.floor(Math.random() * 600));
  }

  // Scroll back up so the top results are visible again — sometimes triggers
  // a refresh fetch with richer payload for the top items.
  await page.evaluate(() => {
    const feed = document.querySelector('[role="feed"]');
    if (feed) feed.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);

  // Click each result card to trigger Google's per-place detail fetch.
  // Clicking opens the side panel and fires the rich-data XHR (extensions,
  // hours, user-review snippet, photos, etc.). We then scroll inside the
  // detail panel which triggers Google to paginate MORE reviews/photos
  // into the same response — so when the orchestrator stores reviews_data
  // and photos_data they include the full first 30-50 items, not just 8.
  if (hoverEach) {
    const cardLinks = await page.$$('[role="feed"] a[href*="/place/"]');
    for (let i = 0; i < Math.min(cardLinks.length, 25); i++) {
      try {
        await cardLinks[i].click({ timeout: 3000 });
        await page.waitForTimeout(900 + Math.floor(Math.random() * 400));

        // Scroll the place detail panel a couple of times to load more
        // reviews/photos in the same XHR cluster.
        for (let s = 0; s < 3; s++) {
          await page.evaluate(() => {
            const panels = document.querySelectorAll('[role="main"]');
            for (const panel of panels) panel.scrollBy(0, 1500);
          });
          await page.waitForTimeout(450 + Math.floor(Math.random() * 200));
        }

        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(200);
      } catch {
        /* click failed — keep going */
      }
    }
    await page.waitForTimeout(1500);
  }

  // Persist raw captures for debugging / future schema fixes.
  if (rawDir) {
    await mkdir(rawDir, { recursive: true });
    for (let i = 0; i < captures.length; i++) {
      await writeFile(`${rawDir}/capture-${i}.txt`, captures[i].text);
      await writeFile(`${rawDir}/capture-${i}.url`, captures[i].url);
    }
  }

  await browser.close();

  if (navError) throw navError;
  if (!captures.length) throw new Error('No Google Maps XHR responses captured.');

  // Collect every place tuple seen across all captures.
  // Order matters — capture-0 typically defines the top-result ranking,
  // and we follow that ranking for `position`. Richer data from later
  // captures gets merged into the earlier records.
  const orderedPlaceIds = [];
  const byPlaceId = new Map();
  for (const cap of captures) {
    let parsed;
    try {
      parsed = parseGoogleResponse(cap.text);
    } catch {
      continue;
    }
    const list = findResultList(parsed);
    for (const tuple of list) {
      const p = tuple[1];
      const pid = p?.[78] ?? p?.[10];
      if (!pid) continue;
      const nonNull = p.filter((v) => v != null).length;
      const existing = byPlaceId.get(pid);
      if (!existing) {
        byPlaceId.set(pid, { tuple, rich: nonNull });
        orderedPlaceIds.push(pid);
      } else if (nonNull > existing.rich) {
        // Replace with richer copy — keeps the position ranking from capture-0.
        byPlaceId.set(pid, { tuple, rich: nonNull });
      }
    }
  }

  const local_results = [];
  let pos = 1;
  for (const pid of orderedPlaceIds) {
    const { tuple } = byPlaceId.get(pid);
    const place = parsePlace(tuple, pos);
    if (place) {
      local_results.push(place);
      pos += 1;
    }
  }

  // Compose a SerpApi-shaped envelope.
  const finishedAt = new Date();
  return {
    search_metadata: {
      id: `local-${startedAt.getTime()}`,
      status: 'Success',
      created_at: startedAt.toISOString().replace('T', ' ').replace(/\..+$/, ' UTC'),
      processed_at: finishedAt.toISOString().replace('T', ' ').replace(/\..+$/, ' UTC'),
      google_maps_url: url,
      total_time_taken: +((finishedAt - startedAt) / 1000).toFixed(2),
    },
    search_parameters: {
      engine: 'google_maps',
      type: 'search',
      q,
      ll,
      google_domain: 'google.com',
      hl,
    },
    search_information: {
      local_results_state: local_results.length ? 'Results for exact spelling' : 'No results',
      query_displayed: q,
    },
    local_results,
  };
}

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}
