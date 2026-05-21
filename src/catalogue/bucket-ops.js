// Surgical catalogue-bucket maintenance for admin CRUD on places/.
//
// hotInsertPlaceIntoCatalogue (in hot-insert.js) handles the "add"
// case by splicing into the right bucket(s). For "update" we ALSO
// need to remove the place from buckets it no longer belongs to
// (admin changed primary_slug from coffee → bakery). For "delete"
// we need to remove it from every bucket it appears in.
//
// Both operations share the same primitive: walk
// `catalogue_buckets/*`, find every doc whose `places` array contains
// the target place_id, splice it out, decrement place_count, write
// back. Costs at most one collection-read + one write per affected
// bucket (typically 1-2).

import { hotInsertPlaceIntoCatalogue } from './hot-insert.js';

/// Remove [placeId] from every `catalogue_buckets/*` doc that has it
/// in its `places` array. Refreshes `catalogue_meta/index` afterwards.
/// Returns the list of bucket doc IDs that were touched.
export async function removePlaceFromAllBuckets(db, placeId) {
  if (!placeId) return { touched: [] };
  const snap = await db.collection('catalogue_buckets').get();
  const touched = [];
  for (const bucket of snap.docs) {
    const data = bucket.data();
    const places = Array.isArray(data.places) ? data.places : [];
    const filtered = places.filter((p) => p.place_id !== placeId);
    if (filtered.length === places.length) continue; // no match in this bucket
    await bucket.ref.set({
      ...data,
      place_count: filtered.length,
      places: filtered,
      generated_at: new Date().toISOString(),
    });
    touched.push(bucket.id);
  }
  if (touched.length) {
    try {
      await refreshCatalogueIndex(db);
    } catch (e) {
      console.warn('[bucket-ops] index refresh failed:', e.message);
    }
  }
  return { touched };
}

/// Reconcile buckets for an UPDATED place. Two-step:
///   1. Remove the place from every bucket (covers source_categories
///      changes — a place that was in `coffee` and moved to `bakery`).
///   2. Hot-insert against the new place data (lands in the right
///      bucket(s) with the updated compact payload).
///
/// Net effect: bucket membership exactly matches the place's current
/// `source_categories`, AND the compact payload (title, rating, etc.)
/// is refreshed everywhere it appears.
export async function syncPlaceToCatalogue(db, place) {
  await removePlaceFromAllBuckets(db, place.place_id);
  await hotInsertPlaceIntoCatalogue(db, place);
}

/// Same logic as hot-insert.js#refreshCatalogueIndex, kept private
/// there. Duplicated here so the delete path doesn't need to import
/// hot-insert.js (avoids a cycle if we ever split modules further).
async function refreshCatalogueIndex(db) {
  const snap = await db.collection('catalogue_buckets').get();
  const mainsAcc = {};
  const seenPerMain = {};
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
