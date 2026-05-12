import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { enrichWithScores, isAccepted } from '../parsers/scoring.js';

// Merge a fresh SerpApi-shaped scrape result into a persistent place record.
// Returns the merged record + a change classification used for telemetry.
export function mergePlace(prev, fresh, { now, scrapeRunId, category, anchorId }) {
  // Preserve discovery metadata across scrapes.
  const first_seen_at = prev?.first_seen_at ?? now;
  const previous_rating = prev?.rating;
  const previous_reviews = prev?.reviews;

  // Categories list — the same place often surfaces under multiple queries
  // (e.g. a fish restaurant under both "restaurant" and "fish restaurant").
  const categories = new Set(prev?.source_categories ?? []);
  categories.add(category);

  const anchors = new Set(prev?.source_anchors ?? []);
  anchors.add(anchorId);

  // Classify what actually changed so the UI can show "New" / "Newly rated" badges.
  const changes = [];
  if (!prev) changes.push('first_seen');
  if (prev && typeof fresh.rating === 'number' && fresh.rating !== prev.rating) {
    changes.push(`rating:${prev.rating}→${fresh.rating}`);
  }
  if (prev && typeof fresh.reviews === 'number' && fresh.reviews !== prev.reviews) {
    changes.push(`reviews:${prev.reviews ?? 0}→${fresh.reviews}`);
  }

  // Keep the smallest position seen across anchors — that's the place's best
  // rank in any neighborhood, which is the most useful signal for sorting in
  // the app. (Last-scrape position would shift around for popular places
  // depending on which anchor ran last.)
  const bestPosition = Math.min(
    prev?.position ?? Number.POSITIVE_INFINITY,
    fresh.position ?? Number.POSITIVE_INFINITY
  );

  // For richness fields (reviews_data, photos_data, rating_summary) prefer
  // the longest available across past + present scrapes — once we've ever
  // captured rich data for a place, keep it even if a later lite scrape
  // didn't include it.
  const longerOf = (a, b) => {
    if (!Array.isArray(a)) return b;
    if (!Array.isArray(b)) return a;
    return b.length > a.length ? b : a;
  };

  const merged = {
    ...fresh,
    position: Number.isFinite(bestPosition) ? bestPosition : fresh.position,
    source_categories: [...categories].sort(),
    source_anchors: [...anchors].sort(),
    reviews_data: longerOf(prev?.reviews_data, fresh.reviews_data),
    photos_data: longerOf(prev?.photos_data, fresh.photos_data),
    rating_summary: longerOf(prev?.rating_summary, fresh.rating_summary),
    first_seen_at,
    last_seen_at: now,
    last_scraped_at: now,
    last_changed_at: changes.length ? now : prev?.last_changed_at ?? first_seen_at,
    last_scrape_run_id: scrapeRunId,
    previous_rating,
    previous_reviews,
  };

  // Drop fields with no value so the document stays lean.
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];

  // Recompute scoring on the merged record — fresh signals (new reviews,
  // newly-added photos) can move both weighted_rating and quality_score.
  enrichWithScores(merged);

  return { merged, changes };
}

// Load the persistent store from disk. The store is `{ "<place_id>": {...record} }`.
// We use a single JSON file by default for simplicity; the orchestrator can swap
// this for Firestore in production (see `firestore.js`).
export async function loadStore(path) {
  if (!existsSync(path)) return { places: {} };
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return { places: {} };
  }
}

export async function saveStore(path, store) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2));
}

// Apply a SerpApi-shaped scrape result to the store, returning a diff summary.
export function applyScrape(store, scrapeResult, { scrapeRunId, category, anchorId }) {
  const now = new Date().toISOString();
  const stats = { found: 0, rejected: 0, new: 0, updated: 0, unchanged: 0 };
  for (const place of scrapeResult.local_results ?? []) {
    if (!place.place_id) continue;
    stats.found += 1;
    // Trust-and-safety: skip places that look like fake / mis-categorised
    // pins (no photo + no address + zero reviews, or outside the city
    // bounding box).
    if (!isAccepted(place)) {
      stats.rejected += 1;
      continue;
    }
    const prev = store.places[place.place_id];
    const { merged, changes } = mergePlace(prev, place, {
      now, scrapeRunId, category, anchorId,
    });
    if (!prev) stats.new += 1;
    else if (changes.length) stats.updated += 1;
    else stats.unchanged += 1;
    store.places[place.place_id] = merged;
  }
  return stats;
}
