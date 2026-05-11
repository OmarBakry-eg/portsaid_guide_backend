import { pick } from '../util/pb.js';
import { buildReviewsLink, buildPhotosLink, buildPlaceLink, proxyImage } from '../config.js';

// Each result in the Google Maps `pb` response is shaped like [null, [...place]]
// where the inner array (260+ entries, mostly null) holds every place field.
// The indices below are verified against live responses (2026).

const DAY_MAP_LC = {
  monday: 'monday', tuesday: 'tuesday', wednesday: 'wednesday',
  thursday: 'thursday', friday: 'friday', saturday: 'saturday', sunday: 'sunday',
};

function extractCoords(p) {
  const lat = pick(p, 9, 2) ?? pick(p, 208, 0, 2);
  const lon = pick(p, 9, 3) ?? pick(p, 208, 0, 3);
  if (typeof lat === 'number' && typeof lon === 'number') {
    return { latitude: lat, longitude: lon };
  }
  return undefined;
}

function extractCategories(p) {
  const cats = pick(p, 13);
  return Array.isArray(cats) ? cats.filter((x) => typeof x === 'string') : [];
}

function extractTypeIds(p) {
  // [76] = array of [type_id_string, null, n]
  const raw = pick(p, 76);
  const ids = Array.isArray(raw)
    ? raw.map((e) => pick(e, 0)).filter((s) => typeof s === 'string')
    : [];
  if (ids.length) return ids;
  // Fallback: derive from category names
  return extractCategories(p).map((c) =>
    c.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  );
}

function extractOperatingHours(p) {
  // [203][0] = array of 7 days; each day is
  //   [day_name, day_idx, [y,m,d], [[hours_str, ...]], 0, 1]
  const days = pick(p, 203, 0);
  if (!Array.isArray(days)) return undefined;
  const out = {};
  for (const d of days) {
    const name = typeof d?.[0] === 'string' ? d[0].toLowerCase() : null;
    const key = name && DAY_MAP_LC[name];
    if (!key) continue;
    const spans = pick(d, 3);
    if (Array.isArray(spans) && spans.length) {
      const text = spans.map((sp) => pick(sp, 0)).filter((s) => typeof s === 'string').join(', ');
      if (text) out[key] = text;
    }
  }
  return Object.keys(out).length === 7 ? out : Object.keys(out).length ? out : undefined;
}

// Derive the current open-state string ("Open · Closes 2 AM" or "Open 24 hours").
// In search-list responses these strings appear inside per-day entries; in
// per-place responses they're at fixed offsets `[203][1][4][0]` / `[5][0]`.
// We try every plausible path and return the first match.
function extractOpenState(p) {
  const direct = [
    pick(p, 203, 1, 4, 0),
    pick(p, 203, 1, 5, 0),
    pick(p, 203, 1, 8, 0),
  ];
  for (const c of direct) {
    if (typeof c === 'string' && /^(Open|Closed|Opens|Closes)/.test(c)) return c;
  }
  // Fall back: scan the days inside [203][0] for an Open/Closed entry.
  const days = pick(p, 203, 0);
  if (Array.isArray(days)) {
    for (const d of days) {
      for (const path of [[4, 0], [5, 0], [3, 0, 0]]) {
        const c = pick(d, ...path);
        if (typeof c === 'string' && /^(Open|Closed|Opens|Closes)/.test(c)) return c;
      }
    }
  }
  return undefined;
}

function extractPrice(p) {
  // [4][2] is the human-readable range; [4][10] is the long form.
  const s = pick(p, 4, 2);
  return typeof s === 'string' && /[\d£$€¥]/.test(s) ? s : undefined;
}

function extractedPrice(priceStr) {
  if (typeof priceStr !== 'string') return undefined;
  const m = /(\d[\d,]*)/.exec(priceStr);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : undefined;
}

function extractPhone(p) {
  return pick(p, 178, 0, 0);
}

function extractWebsite(p) {
  const w = pick(p, 7, 0);
  return typeof w === 'string' && /^https?:\/\//.test(w) ? w : undefined;
}

function extractThumbnail(p) {
  // [37][0][0][6][0] is the primary photo URL.
  const candidates = [
    pick(p, 37, 0, 0, 6, 0),
    pick(p, 51, 0, 0, 6, 0),
    pick(p, 72, 0, 0, 6, 0),
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//.test(c)) return proxyImage(c);
  }
  return undefined;
}

function extractUserReview(p) {
  // Search-list responses: featured snippet at [142][1][0][1][0][0].
  const snippet = pick(p, 142, 1, 0, 1, 0, 0);
  if (typeof snippet === 'string' && snippet.length > 5) return snippet;

  // Per-place responses: pull the first review text from the reviews array
  // at [175][9][0][0][N][0][2][15][0][0]. Truncate to a snippet length.
  const reviewsList = pick(p, 175, 9, 0, 0);
  if (Array.isArray(reviewsList)) {
    for (const rev of reviewsList) {
      const text = pick(rev, 0, 2, 15, 0, 0);
      if (typeof text === 'string' && text.length > 10) {
        // Trim to one-line snippet (~120 chars) and strip surrounding quotes.
        let s = text.replace(/^["“”']+|["“”']+$/g, '');
        const firstLine = s.split(/\n/)[0];
        if (firstLine.length <= 200) return `"${firstLine}"`;
        return `"${firstLine.slice(0, 200).trimEnd()}…"`;
      }
    }
  }
  return undefined;
}

// Full reviews list — present in per-place rich responses at [175][9][0][0].
// Returns top N reviews in SerpApi `reviews` shape.
function extractReviews(p, max = 8) {
  const list = pick(p, 175, 9, 0, 0);
  if (!Array.isArray(list)) return undefined;
  const out = [];
  let pos = 1;
  for (const rev of list.slice(0, max)) {
    const userBlock = pick(rev, 0, 1);
    const reviewBlock = pick(rev, 0, 2);
    const rating = pick(reviewBlock, 0, 0);
    const snippet = pick(reviewBlock, 15, 0, 0);
    if (typeof rating !== 'number' || typeof snippet !== 'string') continue;

    const username = pick(userBlock, 4, 0, 4);
    const contributor_id = pick(userBlock, 4, 5, 3);
    const user_thumbnail = pick(userBlock, 4, 0, 0);
    const reviews_count = pick(userBlock, 5, 5, 0);
    const photos_count = pick(userBlock, 5, 6, 0);
    const date = pick(reviewBlock, 6);
    const iso_date = pick(reviewBlock, 27);
    const iso_edit = pick(reviewBlock, 28) ?? iso_date;
    const imgs = pick(reviewBlock, 14);
    const images = Array.isArray(imgs)
      ? imgs
          .map((im) => pick(im, 6, 0))
          .filter((u) => typeof u === 'string')
          .map((u) => proxyImage(u))
      : undefined;

    out.push({
      position: pos++,
      rating,
      snippet,
      date: typeof date === 'string' ? date : undefined,
      iso_date: typeof iso_date === 'string' ? iso_date : undefined,
      iso_date_of_last_edit: typeof iso_edit === 'string' ? iso_edit : undefined,
      images,
      user: {
        name: typeof username === 'string' ? username : undefined,
        contributor_id: typeof contributor_id === 'string' ? contributor_id : undefined,
        thumbnail: typeof user_thumbnail === 'string' ? proxyImage(user_thumbnail) : undefined,
        reviews: typeof reviews_count === 'number' ? reviews_count : undefined,
        photos: typeof photos_count === 'number' ? photos_count : undefined,
      },
    });
  }
  return out.length ? out : undefined;
}

// Photo URLs — Google scatters them across many indices in the per-place
// response. Rather than hardcoding paths, walk the whole subtree at [37],
// [51], [72], [171] and collect every Google CDN URL with a size suffix.
function extractPhotos(p, max = 50) {
  const seenBase = new Set();
  const photos = [];

  function visit(node) {
    if (photos.length >= max) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
    } else if (
      typeof node === 'string' &&
      /^https:\/\/lh\d+\.googleusercontent\.com\/(gps-|grass-)/.test(node)
    ) {
      // Normalise base by stripping size suffix.
      const base = node.replace(/=[\w-]+(=[\w-]+)?$/, '');
      if (seenBase.has(base)) return;
      seenBase.add(base);
      const thumbnail = node.replace(/=[\w-]+(=[\w-]+)?$/, '=w406-h541-k-no');
      const image = node.replace(/=[\w-]+(=[\w-]+)?$/, '=w1080-h1920-k-no');
      photos.push({ thumbnail: proxyImage(thumbnail), image: proxyImage(image) });
    }
  }

  for (const key of [37, 51, 72, 171, 175]) visit(pick(p, key));
  return photos.length ? photos : undefined;
}

// 1-5 star rating distribution at [52][1].
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

// Map service-option labels into the booleans SerpApi emits.
function deriveServiceOptions(extensions) {
  const so = extensions.find((g) => g.service_options)?.service_options ?? [];
  const out = {};
  for (const opt of so) {
    const lc = opt.toLowerCase();
    if (lc.includes('no-contact delivery')) out.no_contact_delivery = true;
    else if (lc.includes('delivery')) out.delivery = true;
    if (lc.includes('takeout')) out.takeout = true;
    if (lc.includes('dine-in')) out.dine_in = true;
    if (lc.includes('drive-through')) out.drive_through = true;
    if (lc.includes('curbside')) out.curbside_pickup = true;
    if (lc.includes('outdoor seating')) out.outdoor_seating = true;
  }
  return Object.keys(out).length ? out : undefined;
}

// SerpApi normalises Google's group labels to specific snake_case keys.
function normalizeGroupKey(rawKey, label) {
  if (typeof rawKey === 'string' && rawKey) return rawKey;
  const lc = String(label || '').toLowerCase();
  if (lc.includes('service options')) return 'service_options';
  if (lc.includes('highlight')) return 'highlights';
  if (lc.includes('popular for')) return 'popular_for';
  if (lc.includes('accessibility')) return 'accessibility';
  if (lc.includes('offering')) return 'offerings';
  if (lc.includes('dining option')) return 'dining_options';
  if (lc.includes('amenit')) return 'amenities';
  if (lc.includes('atmosphere')) return 'atmosphere';
  if (lc.includes('crowd')) return 'crowd';
  if (lc.includes('planning')) return 'planning';
  if (lc.includes('payment')) return 'payments';
  if (lc.includes('children')) return 'children';
  if (lc.includes('parking')) return 'parking';
  if (lc.includes('pets')) return 'pets';
  return lc.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// [100][1] = array of [group_key, group_label, items[]] where each item is
// [feature_id, display_label, presence_block, ...].
function extractExtensions(p) {
  const groups = pick(p, 100, 1);
  if (!Array.isArray(groups)) return [];
  const out = [];
  for (const g of groups) {
    if (!Array.isArray(g)) continue;
    const rawKey = pick(g, 0);
    const label = pick(g, 1);
    const items = pick(g, 2);
    if (!Array.isArray(items)) continue;
    const values = items
      .map((it) => pick(it, 1))
      .filter((s) => typeof s === 'string');
    if (!values.length) continue;
    // Dedupe within the group — Google sometimes lists the same payment
    // method under multiple sub-buckets (credit cards / debit / NFC) which
    // produces duplicate string entries when we flatten.
    const unique = [...new Set(values)];
    out.push({ [normalizeGroupKey(rawKey, label)]: unique });
  }
  return out;
}

function deriveDataCid(dataId) {
  if (typeof dataId !== 'string') return undefined;
  const parts = dataId.split(':');
  if (parts.length !== 2) return undefined;
  try {
    // The second hex part as an unsigned 64-bit integer in base 10.
    return BigInt(parts[1]).toString();
  } catch {
    return undefined;
  }
}

export function parsePlace(result, position) {
  // Result is wrapped as [null, [...place_data]].
  const p = Array.isArray(result) && Array.isArray(result[1]) ? result[1] : result;
  if (!Array.isArray(p)) return null;

  const title = pick(p, 11);
  if (typeof title !== 'string') return null;

  const placeId = pick(p, 78);
  const dataId = pick(p, 10);
  const dataCid = deriveDataCid(dataId);
  const providerId = pick(p, 89);

  const rating = pick(p, 4, 7);
  const reviews = pick(p, 4, 8);
  const categories = extractCategories(p);
  const typeIds = extractTypeIds(p);
  const operating_hours = extractOperatingHours(p);
  const open_state = extractOpenState(p);
  const price = extractPrice(p);
  const phone = extractPhone(p);
  const website = extractWebsite(p);
  const thumbnail = extractThumbnail(p);
  const user_review = extractUserReview(p);
  const extensions = extractExtensions(p);
  const service_options = deriveServiceOptions(extensions);
  const coords = extractCoords(p);

  const out = {
    position,
    title,
    place_id: typeof placeId === 'string' ? placeId : undefined,
    data_id: typeof dataId === 'string' ? dataId : undefined,
    data_cid: dataCid,
    reviews_link: dataId ? buildReviewsLink(dataId) : undefined,
    photos_link: dataId ? buildPhotosLink(dataId) : undefined,
    gps_coordinates: coords,
    place_id_search: placeId ? buildPlaceLink(placeId) : undefined,
    provider_id: typeof providerId === 'string' ? providerId : undefined,
    rating: typeof rating === 'number' ? rating : undefined,
    reviews: typeof reviews === 'number' ? reviews : undefined,
    price,
    extracted_price: extractedPrice(price),
    type: categories[0],
    types: categories.length ? categories : undefined,
    type_id: typeIds[0],
    type_ids: typeIds.length ? typeIds : undefined,
    address: pick(p, 39) ?? pick(p, 18),
    open_state,
    hours: open_state,
    operating_hours,
    phone,
    website,
    extensions: extensions.length ? extensions : undefined,
    service_options,
    user_review,
    thumbnail,
    // The next three fields are only populated when Google returned the rich
    // per-place response (i.e. the place was clicked into during scraping).
    // They make /reviews and /photos endpoints zero-latency.
    reviews_data: extractReviews(p),
    photos_data: extractPhotos(p),
    rating_summary: extractRatingSummary(p),
  };

  // Strip undefined keys for SerpApi-style compact output.
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
