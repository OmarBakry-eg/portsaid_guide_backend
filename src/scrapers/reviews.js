// Scrape ALL reviews for a place by repeatedly scrolling the reviews tab
// until Google stops returning new ones. Returns a SerpApi-shaped envelope;
// the server slices it into pages of 8 with `next_page_token`.

import { chromium } from 'playwright';
import { parseGoogleResponse, pick } from '../util/pb.js';
import { proxyImage } from '../config.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function isReviewsXhr(url) {
  return (
    /\/maps\/preview\/review\/listentitiesreviews/.test(url) ||
    /\/maps\/preview\/place\?/.test(url) ||
    /ListEntityReviews/.test(url) ||
    /listentitiesreviews/i.test(url)
  );
}

function buildReviewsViewUrl(dataId, hl) {
  // The reviews-tab data URL Google itself uses (the `!9m1!1b1` flag).
  return `https://www.google.com/maps/place/data=!4m7!3m6!1s${dataId}!5m2!4m1!1i2!9m1!1b1?hl=${hl}`;
}

// Map a raw review entry to SerpApi shape. Tolerates the two slight variants
// Google uses (one inside `[175][9][0][0]`, one inside `listentitiesreviews`
// at `[2][...]`).
function mapReview(rev, position) {
  // Two possible nestings:
  //   A) `rev[0][1]` (user) + `rev[0][2]` (review body)  ← place response
  //   B) `rev[0]`                                         ← reviews-only response
  const userBlock = pick(rev, 0, 1);
  const reviewBlock = pick(rev, 0, 2) ?? pick(rev, 1);
  if (!Array.isArray(reviewBlock)) return null;

  const rating = pick(reviewBlock, 0, 0) ?? pick(reviewBlock, 4);
  const snippet = pick(reviewBlock, 15, 0, 0) ?? pick(reviewBlock, 3);
  if (typeof rating !== 'number' || typeof snippet !== 'string') return null;

  const username = pick(userBlock, 4, 0, 4) ?? pick(reviewBlock, 0, 1);
  const contributor_id = pick(userBlock, 4, 5, 3) ?? pick(reviewBlock, 0, 0);
  const user_thumbnail = pick(userBlock, 4, 0, 0) ?? pick(reviewBlock, 0, 2);
  const local_guide = pick(userBlock, 5, 8) === true;
  const reviews_count = pick(userBlock, 5, 5, 0);
  const photos_count = pick(userBlock, 5, 6, 0);

  const link = pick(reviewBlock, 10);
  const review_id = pick(reviewBlock, 0, 14) ?? pick(rev, 0, 0);
  const date = pick(reviewBlock, 6) ?? pick(reviewBlock, 2);
  const iso_date = pick(reviewBlock, 27);
  const iso_edit = pick(reviewBlock, 28) ?? iso_date;
  const likes = pick(reviewBlock, 16) ?? 0;

  const imgsArr = pick(reviewBlock, 14);
  const images = Array.isArray(imgsArr)
    ? imgsArr
        .map((im) => pick(im, 6, 0))
        .filter((u) => typeof u === 'string')
        .map((u) => proxyImage(u))
    : undefined;

  return {
    position,
    link: typeof link === 'string' ? link : undefined,
    rating,
    date: typeof date === 'string' ? date : undefined,
    iso_date: typeof iso_date === 'string' ? iso_date : undefined,
    iso_date_of_last_edit: typeof iso_edit === 'string' ? iso_edit : undefined,
    images,
    source: 'Google',
    review_id: typeof review_id === 'string' ? review_id : undefined,
    user: {
      name: typeof username === 'string' ? username : undefined,
      link:
        typeof contributor_id === 'string'
          ? `https://www.google.com/maps/contrib/${contributor_id}?hl=en-US`
          : undefined,
      contributor_id: typeof contributor_id === 'string' ? contributor_id : undefined,
      thumbnail: typeof user_thumbnail === 'string' ? proxyImage(user_thumbnail) : undefined,
      local_guide,
      reviews: typeof reviews_count === 'number' ? reviews_count : undefined,
      photos: typeof photos_count === 'number' ? photos_count : undefined,
    },
    snippet,
    extracted_snippet: { original: snippet },
    likes: typeof likes === 'number' ? likes : 0,
  };
}

function dedupReviews(reviews) {
  const seen = new Set();
  const out = [];
  for (const r of reviews) {
    const key = r.review_id ?? `${r.user?.name}|${r.snippet?.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, position: out.length + 1 });
  }
  return out;
}

// Walk a parsed response and collect any review-like tuples.
function collectReviews(parsed, sink) {
  // Place-response shape: reviews at [6][175][9][0][0]
  const a = pick(parsed, 6, 175, 9, 0, 0);
  if (Array.isArray(a)) for (const r of a) sink.push(r);
  // listentitiesreviews response shape: [2] is the reviews array
  const b = pick(parsed, 2);
  if (Array.isArray(b)) for (const r of b) sink.push(r);
}

export async function scrapeReviews({ data_id, hl = 'en', max = 100 } = {}) {
  if (!data_id) throw new Error('data_id is required');
  const url = buildReviewsViewUrl(data_id, hl);
  const startedAt = new Date();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'Africa/Cairo',
  });
  const page = await context.newPage();

  const rawReviews = [];
  const topicsBlocks = [];
  const placeInfoCandidates = [];

  page.on('response', async (resp) => {
    try {
      if (!isReviewsXhr(resp.url())) return;
      const text = await resp.text();
      if (!text || text.length < 200) return;
      const parsed = parseGoogleResponse(text);
      collectReviews(parsed, rawReviews);
      // Topics block (popular keywords) sits at [1] in the reviews response,
      // or [6][157] in place responses.
      const t = pick(parsed, 1);
      if (Array.isArray(t)) topicsBlocks.push(t);
      const placeForInfo = pick(parsed, 6);
      if (Array.isArray(placeForInfo) && typeof placeForInfo[11] === 'string') {
        placeInfoCandidates.push(placeForInfo);
      }
    } catch {
      /* ignore parse errors */
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  // Scroll the reviews panel repeatedly. Each scroll fires another
  // paginated XHR until reviews are exhausted.
  let prevCount = -1;
  let stable = 0;
  for (let round = 0; round < 30 && rawReviews.length < max && stable < 3; round++) {
    await page.evaluate(() => {
      const main = document.querySelector('[role="main"]');
      if (main) main.scrollBy(0, 3000);
      window.scrollBy(0, 3000);
    });
    await page.waitForTimeout(800 + Math.floor(Math.random() * 400));
    if (rawReviews.length === prevCount) stable += 1;
    else stable = 0;
    prevCount = rawReviews.length;
  }

  await browser.close();

  // Map + dedupe.
  const mapped = [];
  let pos = 1;
  for (const r of rawReviews) {
    const m = mapReview(r, pos);
    if (m) {
      mapped.push(m);
      pos += 1;
    }
  }
  const reviews = dedupReviews(mapped).slice(0, max);

  // Topics — merge any topic block we saw, dedupe by keyword.
  const topicMap = new Map();
  for (const block of topicsBlocks) {
    for (const t of block) {
      const id = pick(t, 0);
      const keyword = pick(t, 1);
      const mentions = pick(t, 2);
      if (typeof keyword === 'string' && typeof mentions === 'number') {
        if (!topicMap.has(keyword)) {
          topicMap.set(keyword, { keyword, mentions, id });
        }
      }
    }
  }

  // place_info — pull from the place response if we saw one.
  let place_info;
  if (placeInfoCandidates.length) {
    const p = placeInfoCandidates[0];
    place_info = {
      title: p[11],
      address: typeof p[39] === 'string' ? p[39] : undefined,
      rating: pick(p, 4, 7),
      reviews: pick(p, 4, 8),
      type: pick(p, 13, 0),
    };
    for (const k of Object.keys(place_info)) if (place_info[k] == null) delete place_info[k];
  }

  const finishedAt = new Date();
  return {
    search_metadata: {
      id: `local-reviews-${startedAt.getTime()}`,
      status: 'Success',
      created_at: startedAt.toISOString().replace('T', ' ').replace(/\..+$/, ' UTC'),
      processed_at: finishedAt.toISOString().replace('T', ' ').replace(/\..+$/, ' UTC'),
      google_maps_reviews_url: url,
      total_time_taken: +((finishedAt - startedAt) / 1000).toFixed(2),
    },
    search_parameters: { engine: 'google_maps_reviews', data_id, hl },
    place_info,
    topics: topicMap.size ? [...topicMap.values()] : undefined,
    reviews,
  };
}
