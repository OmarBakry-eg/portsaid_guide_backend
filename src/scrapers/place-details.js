// Scrape rich place details for a single place_id. Returns a SerpApi
// `place_results`-shaped object: rating_summary, price_details.distribution,
// popular_times, user_reviews, images, people_also_search_for, etc.
//
// Strategy: navigate to `https://www.google.com/maps/place/?q=place_id:...`,
// capture the `/maps/preview/place` XHR, and parse the same nested array as
// the list scraper plus the deeper fields the detail panel exposes.

import { chromium } from 'playwright';
import { parseGoogleResponse, pick, findArray } from '../util/pb.js';
import { parsePlace } from '../parsers/place.js';
import { buildReviewsLink, buildPhotosLink } from '../config.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function isDetailXhr(url) {
  return /\/maps\/preview\/place\?/.test(url);
}

// ===== Extra-field extractors (only present in the detail response) =====

// [52][1][...] holds the 1-5 star distribution: [[stars, count], ...].
function extractRatingSummary(p) {
  const block = pick(p, 52, 1);
  if (!Array.isArray(block)) return undefined;
  const out = [];
  for (const row of block) {
    const stars = pick(row, 0);
    const amount = pick(row, 1);
    if (typeof stars === 'number' && typeof amount === 'number') {
      out.push({ stars, amount });
    }
  }
  return out.length ? out.sort((a, b) => a.stars - b.stars) : undefined;
}

// [4][9] holds the price-range distribution.
function extractPriceDetails(p) {
  const dist = pick(p, 4, 9);
  if (!Array.isArray(dist)) return undefined;
  const buckets = pick(dist, 0);
  if (!Array.isArray(buckets)) return undefined;
  const distribution = [];
  let totalReported = 0;
  for (const b of buckets) {
    const price = pick(b, 0, 1);
    const counts = pick(b, 1);
    const reported = Array.isArray(counts)
      ? counts.reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0)
      : 0;
    totalReported += reported;
    if (typeof price === 'string') {
      distribution.push({ price, reported_count: reported });
    }
  }
  if (totalReported > 0) {
    for (const b of distribution) {
      b.percentage = (b.reported_count / totalReported) * 100;
    }
  }
  return distribution.length ? { distribution, total_reported: totalReported } : undefined;
}

// [175][9][0][0] = list of reviews. Map each to SerpApi user-review shape.
function extractUserReviews(p) {
  const list = pick(p, 175, 9, 0, 0);
  if (!Array.isArray(list)) return undefined;
  const most_relevant = [];
  for (const rev of list.slice(0, 8)) {
    const userBlock = pick(rev, 0, 1);
    const reviewBlock = pick(rev, 0, 2);
    const username = pick(userBlock, 4, 0, 4);
    const contributor_id = pick(userBlock, 4, 5, 3) ?? pick(userBlock, 4, 8, 0);
    const user_thumbnail = pick(userBlock, 4, 0, 0);
    const userMeta = pick(userBlock, 5);
    const user_review_count = pick(userMeta, 5, 0) ?? pick(userMeta, 5, 1);
    const user_photo_count = pick(userMeta, 6, 0) ?? pick(userMeta, 6, 1);
    const rating = pick(reviewBlock, 0, 0);
    const description = pick(reviewBlock, 15, 0, 0);
    const linkText = pick(reviewBlock, 10);
    const isoDate = pick(reviewBlock, 27);
    const isoEdit = pick(reviewBlock, 28) ?? isoDate;
    const dateLabel = pick(reviewBlock, 6);
    const imagesArr = pick(reviewBlock, 14);
    const images = Array.isArray(imagesArr)
      ? imagesArr
          .map((im) => pick(im, 6, 0))
          .filter((u) => typeof u === 'string')
          .map((u) => ({ thumbnail: u }))
      : undefined;

    if (typeof username === 'string' && typeof rating === 'number') {
      most_relevant.push({
        username,
        rating,
        contributor_id: typeof contributor_id === 'string' ? contributor_id : undefined,
        user_review_count,
        user_photo_count,
        user_thumbnail: typeof user_thumbnail === 'string' ? user_thumbnail : undefined,
        description: typeof description === 'string' ? description : undefined,
        link: typeof linkText === 'string' ? linkText : undefined,
        images,
        date: typeof dateLabel === 'string' ? dateLabel : undefined,
        date_iso8601: typeof isoEdit === 'string' ? isoEdit : undefined,
      });
    }
  }
  return most_relevant.length ? { most_relevant } : undefined;
}

// [37] holds the photos grouped by category ("All", "Food & drink", "Vibe").
function extractImageCategories(p) {
  const groups = pick(p, 37);
  if (!Array.isArray(groups)) return undefined;
  const out = [];
  for (const g of groups.slice(0, 6)) {
    const title = pick(g, 2);
    const thumb = pick(g, 0, 0, 6, 0);
    if (typeof thumb === 'string') {
      out.push({
        title: typeof title === 'string' ? title : 'All',
        thumbnail: thumb,
      });
    }
  }
  return out.length ? out : undefined;
}

// [85][0] = list of "people also search for" places.
function extractPeopleAlsoSearchFor(p) {
  const local_results = [];
  const list = pick(p, 85, 0);
  if (!Array.isArray(list)) return undefined;
  for (const ent of list.slice(0, 5)) {
    const inner = pick(ent, 14) ?? ent;
    const title = pick(inner, 11);
    const dataId = pick(inner, 10);
    const rating = pick(inner, 4, 7);
    const reviews = pick(inner, 4, 8);
    const lat = pick(inner, 9, 2);
    const lon = pick(inner, 9, 3);
    const cats = pick(inner, 13);
    const thumb = pick(inner, 37, 0, 0, 6, 0);
    if (typeof title === 'string') {
      local_results.push({
        position: local_results.length + 1,
        title,
        data_id: dataId,
        reviews_link: dataId ? buildReviewsLink(dataId) : undefined,
        photos_link: dataId ? buildPhotosLink(dataId) : undefined,
        gps_coordinates:
          typeof lat === 'number' && typeof lon === 'number'
            ? { latitude: lat, longitude: lon }
            : undefined,
        rating: typeof rating === 'number' ? rating : undefined,
        reviews: typeof reviews === 'number' ? reviews : undefined,
        thumbnail: typeof thumb === 'string' ? thumb : undefined,
        type: Array.isArray(cats) ? cats : undefined,
      });
    }
  }
  return local_results.length
    ? [{ search_term: 'People also search for', local_results }]
    : undefined;
}

// [84] = popular_times. Block per day with hourly busyness 0-100.
function extractPopularTimes(p) {
  const block = pick(p, 84);
  if (!Array.isArray(block)) return undefined;
  const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const liveBlock = pick(p, 84, 7);
  const live_hash = {};
  if (Array.isArray(liveBlock)) {
    const info = pick(liveBlock, 0);
    if (typeof info === 'string') live_hash.info = info;
  }
  const timeSpent = pick(p, 117, 0);
  if (typeof timeSpent === 'string') live_hash.time_spent = timeSpent;

  const graph_results = {};
  const days = pick(p, 84, 0);
  if (Array.isArray(days)) {
    for (let i = 0; i < days.length && i < 7; i++) {
      const dayBlock = pick(days, i, 1);
      if (!Array.isArray(dayBlock)) continue;
      const slots = [];
      for (const slot of dayBlock) {
        const time = pick(slot, 4, 0);
        const busyness_score = pick(slot, 1);
        if (typeof time === 'string' && typeof busyness_score === 'number') {
          const entry = { time, busyness_score };
          const info = pick(slot, 2);
          if (typeof info === 'string') entry.info = info;
          slots.push(entry);
        }
      }
      if (slots.length) graph_results[dayMap[i]] = slots;
    }
  }

  const today = new Date().getDay();
  return {
    current_day: dayMap[today],
    live_hash: Object.keys(live_hash).length ? live_hash : undefined,
    graph_results: Object.keys(graph_results).length ? graph_results : undefined,
  };
}

// ===== Main entry =====

export async function scrapePlaceDetails({ place_id, hl = 'en' }) {
  if (!place_id) throw new Error('place_id is required');
  const url = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place_id)}&hl=${hl}`;
  const startedAt = new Date();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'Africa/Cairo',
  });
  const page = await context.newPage();

  const captures = [];
  page.on('response', async (resp) => {
    if (!isDetailXhr(resp.url())) return;
    try {
      const text = await resp.text();
      if (text && text.length > 500) captures.push(text);
    } catch {
      /* ignore */
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Wait for the place panel to fully load — drives Google to fire the detail XHR.
  await page.waitForSelector('h1, [role="main"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await browser.close();

  if (!captures.length) throw new Error('No place-detail XHR captured');

  // Use the largest/most complete capture.
  captures.sort((a, b) => b.length - a.length);
  const parsed = parseGoogleResponse(captures[0]);
  const placeArr = pick(parsed, 6);
  if (!Array.isArray(placeArr) || typeof placeArr[11] !== 'string') {
    throw new Error('Place data not found in detail response');
  }

  // Reuse the list-scraper parser for the core fields, then augment with the
  // detail-only fields below.
  const core = parsePlace([null, placeArr], 1);

  const place_results = {
    ...core,
    rating_summary: extractRatingSummary(placeArr),
    price_details: extractPriceDetails(placeArr),
    plus_code: pick(placeArr, 183, 2, 1, 0) ?? undefined,
    images: extractImageCategories(placeArr),
    user_reviews: extractUserReviews(placeArr),
    people_also_search_for: extractPeopleAlsoSearchFor(placeArr),
    popular_times: extractPopularTimes(placeArr),
  };

  // SerpApi's `hours` shape in the detail view is an array of single-day objects,
  // not the per-day map. Reshape to match exactly.
  if (core.operating_hours) {
    place_results.hours = Object.entries(core.operating_hours).map(([day, h]) => ({ [day]: h }));
  }

  // Drop helper fields that don't belong in detail output.
  delete place_results.position;
  for (const k of Object.keys(place_results)) {
    if (place_results[k] === undefined) delete place_results[k];
  }

  const finishedAt = new Date();
  return {
    search_metadata: {
      id: `local-place-${startedAt.getTime()}`,
      status: 'Success',
      created_at: startedAt.toISOString().replace('T', ' ').replace(/\..+$/, ' UTC'),
      processed_at: finishedAt.toISOString().replace('T', ' ').replace(/\..+$/, ' UTC'),
      google_maps_url: url,
      total_time_taken: +((finishedAt - startedAt) / 1000).toFixed(2),
    },
    search_parameters: {
      engine: 'google_maps',
      place_id,
      google_domain: 'google.com',
      hl,
    },
    place_results,
  };
}
