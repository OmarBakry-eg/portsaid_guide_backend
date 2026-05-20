// Targeted catalogue-bucket update for a SINGLE newly-approved place.
//
// The cron pipeline rebuilds `catalogue_buckets/*` wholesale via
// `writeCatalogue(buildCatalogue(places))`. That's correct but
// expensive — and admin approvals happen between cron runs. Without
// a hot insert path, an approved place would live in `places/{id}`
// but never appear in the mobile's bucket-driven category browse
// until the next scrape, which can be hours away.
//
// This helper does the minimum write needed so the place shows up on
// every user's home immediately:
//   1. For each (main, sub) pair the place qualifies for, fetch the
//      `catalogue_buckets/{main}__{sub}` doc, splice/dedupe the new
//      compact entry into its `places` array, re-sort by sort_score,
//      bump place_count, write back. Average ~1 read + 1 write per
//      bucket touched.
//   2. Refresh `catalogue_meta/index` so the home-screen totals on
//      the mobile (which read from the index) stay in sync.
//
// What it does NOT do:
//   - Doesn't rebuild Other's dynamic type buckets. If primary_slug
//     is 'other', we fall through to `other__misc` (the canonical
//     overflow bucket from buildCatalogue). The next scrape will
//     re-rank and possibly graduate the place to its own `type_*`
//     sub — that's fine, it's a refinement not a correctness issue.
//   - Doesn't recompute meta/place_types. That snapshot is used for
//     a less-critical view; it'll catch up on the next scrape.

import { toCompactPlace } from './compact.js';
import { mainCategoryForSub } from './main-of.js';
import { MAIN_CATEGORIES } from './bucket.js';

const ALL_KNOWN_SUB_SLUGS = new Set(
  MAIN_CATEGORIES.flatMap((m) => m.subSlugs)
);

/// Splice the place into every bucket that its `source_categories` AND
/// its `primary_slug` qualify for. Returns the list of bucket doc IDs
/// that were touched (`food__coffee`, `finance__bank`, …) for logging.
///
/// Idempotent: re-running with the same place is a no-op (dedup by
/// place_id inside each bucket's `places` array).
///
/// [db]: Firestore Admin client
/// [place]: full place doc (same shape `writeCatalogue` consumes)
export async function hotInsertPlaceIntoCatalogue(db, place) {
  if (!place || !place.place_id) return { touched: [], reason: 'no place' };
  const compact = toCompactPlace(place, { surfacedVia: 'identity' });
  if (!compact) return { touched: [], reason: 'compact-null' };

  // Resolve target (main, sub) pairs from source_categories. Each one
  // that matches a curated sub-slug yields a bucket update.
  const targets = new Set(); // 'mainSlug__subSlug'
  const cats = Array.isArray(place.source_categories)
      ? place.source_categories
      : [];
  for (const sub of cats) {
    if (!ALL_KNOWN_SUB_SLUGS.has(sub)) continue;
    const main = mainCategoryForSub(sub);
    if (!main) continue;
    targets.add(`${main}__${sub}`);
  }

  // Fallback: no known sub-slug → land in `other__misc` so the place
  // surfaces SOMEWHERE in the user-facing catalogue. The next scrape
  // re-ranks Other and may graduate it to its own type bucket.
  if (targets.size === 0) {
    targets.add('other__misc');
  }

  const touched = [];
  for (const docId of targets) {
    try {
      await spliceIntoBucket(db, docId, compact);
      touched.push(docId);
    } catch (e) {
      console.warn(
        `[hot-insert] bucket ${docId} update failed: ${e.message}`
      );
    }
  }

  // Refresh the index doc's main/sub counts. Cheap (~1 read of every
  // catalogue_buckets/*, ~1 write of meta/index) — runs at admin-
  // approve cadence, not per-cron-place, so the cost is fine.
  try {
    await refreshCatalogueIndex(db);
  } catch (e) {
    console.warn(`[hot-insert] index refresh failed: ${e.message}`);
  }

  return { touched };
}

/// Read-modify-write the named bucket doc. Dedup by place_id; re-sort
/// by sort_score desc with nulls last.
async function spliceIntoBucket(db, docId, compact) {
  const ref = db.collection('catalogue_buckets').doc(docId);
  const snap = await ref.get();
  let data;
  if (!snap.exists) {
    // First time this bucket exists — synthesise the doc fields from
    // the docId. `main__sub`. Label is null → mobile uses its static
    // label for the slug. raw_type is null because this isn't a
    // dynamic `other__type_*` bucket.
    const [mainSlug, subSlug] = docId.split('__');
    data = {
      main: mainSlug,
      sub: subSlug,
      label: null,
      raw_type: null,
      place_count: 0,
      places: [],
      generated_at: new Date().toISOString(),
    };
  } else {
    data = snap.data();
  }

  // Dedup: replace any existing entry with the same place_id (so the
  // newer compact wins) rather than appending a duplicate.
  const places = Array.isArray(data.places) ? data.places : [];
  const filtered = places.filter((p) => p.place_id !== compact.place_id);
  filtered.push(compact);

  // Same default sort `writeCatalogue` uses: sort_score desc, nulls
  // sink to the bottom. Mobile re-sorts client-side per the user's
  // SortMode, but the static order matters for the first paint.
  filtered.sort((a, b) =>
      (b.sort_score ?? -Infinity) - (a.sort_score ?? -Infinity));

  await ref.set({
    ...data,
    place_count: filtered.length,
    places: filtered,
    generated_at: new Date().toISOString(),
  });
}

/// Recompute meta/index from the current catalogue_buckets/* docs.
/// Cheap on this app's scale (~65 small docs).
async function refreshCatalogueIndex(db) {
  const snap = await db.collection('catalogue_buckets').get();
  const mainsAcc = {};
  const seenPerMain = {}; // mainSlug → Set of place_ids

  for (const doc of snap.docs) {
    const d = doc.data();
    const m = d.main;
    const s = d.sub;
    if (!m || !s) continue;
    if (!mainsAcc[m]) {
      mainsAcc[m] = { place_count: 0, subs: [] };
      seenPerMain[m] = new Set();
    }
    mainsAcc[m].subs.push({
      sub: s,
      label: d.label ?? null,
      raw_type: d.raw_type ?? null,
      place_count: d.place_count ?? 0,
    });
    for (const p of (d.places ?? [])) {
      if (p?.place_id) seenPerMain[m].add(p.place_id);
    }
  }

  // Distinct-place counts per main + sub sort (count desc, slug asc).
  let totalPlaces = 0;
  for (const [mainSlug, main] of Object.entries(mainsAcc)) {
    main.place_count = seenPerMain[mainSlug]?.size ?? 0;
    totalPlaces += main.place_count;
    main.subs.sort((a, b) =>
        b.place_count - a.place_count || a.sub.localeCompare(b.sub));
  }

  await db.collection('catalogue_meta').doc('index').set({
    generated_at: new Date().toISOString(),
    version: 1,
    total_places: totalPlaces,
    mains: mainsAcc,
  });
}
