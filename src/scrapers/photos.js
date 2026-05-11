// Scrape ALL photos for a place by scrolling the photos grid until Google
// stops returning new ones. Returns a SerpApi-shaped envelope with the full
// list; the server slices it into pages of 20 with `next_page_token`.

import { chromium } from 'playwright';
import { parseGoogleResponse, pick } from '../util/pb.js';
import { proxyImage } from '../config.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function isPhotosXhr(url) {
  return /\/maps\/rpc\/photo\/listentityphotos/.test(url) ||
    /\/maps\/preview\/photo\?/.test(url) ||
    /MapsPhotoService\.ListEntityPhotos/.test(url);
}

function buildPhotosViewUrl(dataId, hl) {
  // `!1e2` opens the Photos tab.
  return `https://www.google.com/maps/place/data=!4m3!3m2!1s${dataId}!1e2?hl=${hl}`;
}

function sizeOf(url, w, h) {
  if (typeof url !== 'string') return undefined;
  return url.replace(/=w\d+-h\d+[^,]*/, `=w${w}-h${h}-k-no`);
}

// Walk a parsed response tree looking for photo entries. Each entry has a
// `googleusercontent.com/gps-` or `/grass-` URL at a known sub-path.
function extractPhotoUrlsFrom(node, sink) {
  if (Array.isArray(node)) {
    for (const child of node) extractPhotoUrlsFrom(child, sink);
  } else if (
    typeof node === 'string' &&
    /^https:\/\/lh\d+\.googleusercontent\.com\/(gps-|grass-)/.test(node)
  ) {
    sink.add(node);
  }
}

export async function scrapePhotos({ data_id, hl = 'en', max = 100 } = {}) {
  if (!data_id) throw new Error('data_id is required');
  const url = buildPhotosViewUrl(data_id, hl);
  const startedAt = new Date();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'Africa/Cairo',
  });
  const page = await context.newPage();

  // We accumulate photo URLs from every photos-related XHR we observe.
  const urls = new Set();
  const placeXhrBodies = [];
  page.on('response', async (resp) => {
    try {
      const u = resp.url();
      const isPhotos = isPhotosXhr(u);
      const isPlace = /\/maps\/preview\/place\?/.test(u);
      if (!isPhotos && !isPlace) return;
      const text = await resp.text();
      if (!text || text.length < 100) return;
      try {
        const parsed = parseGoogleResponse(text);
        extractPhotoUrlsFrom(parsed, urls);
        if (isPlace) placeXhrBodies.push(parsed);
      } catch {
        // Fallback: regex-extract raw URLs from the response body.
        const re = /https:\/\/lh\d+\.googleusercontent\.com\/(?:gps-|grass-)[^"'\\)\s]+/g;
        for (const m of text.match(re) ?? []) urls.add(m);
      }
    } catch {
      /* ignore */
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  // Scroll the photos grid repeatedly to trigger pagination XHRs.
  // Stops early when no new photo arrives between rounds (Google's grid is
  // a continuous virtual scroll, so this is the only signal we get).
  let prevCount = -1;
  let stableRounds = 0;
  for (let round = 0; round < 25 && urls.size < max && stableRounds < 2; round++) {
    await page.evaluate(() => {
      const grid =
        document.querySelector('[role="main"]') ??
        document.querySelector('div[aria-label*="Photo"]') ??
        document.scrollingElement;
      if (grid) grid.scrollBy(0, 4000);
      window.scrollBy(0, 4000);
    });
    await page.waitForTimeout(800 + Math.floor(Math.random() * 400));
    if (urls.size === prevCount) stableRounds += 1;
    else stableRounds = 0;
    prevCount = urls.size;
  }

  await browser.close();

  if (urls.size === 0) throw new Error('No photo URLs captured');

  // Convert collected base URLs into thumbnail+image pairs, deduped,
  // proxied through our /img endpoint by default.
  const seenBase = new Set();
  const photos = [];
  for (const u of urls) {
    // Normalise: strip the size suffix to get a base id used for dedup.
    const base = u.replace(/=[wmhk\d-]+(-no|-k|-c-no|-c-n)?$/, '');
    if (seenBase.has(base)) continue;
    seenBase.add(base);
    photos.push({
      thumbnail: proxyImage(sizeOf(u, 406, 541) ?? u),
      image: proxyImage(sizeOf(u, 1080, 1920) ?? u),
    });
    if (photos.length >= max) break;
  }

  const finishedAt = new Date();
  return {
    search_metadata: {
      id: `local-photos-${startedAt.getTime()}`,
      status: 'Success',
      created_at: startedAt.toISOString().replace('T', ' ').replace(/\..+$/, ' UTC'),
      processed_at: finishedAt.toISOString().replace('T', ' ').replace(/\..+$/, ' UTC'),
      google_maps_photos_url: url,
      total_time_taken: +((finishedAt - startedAt) / 1000).toFixed(2),
    },
    search_parameters: { engine: 'google_maps_photos', data_id, hl },
    photos,
  };
}
