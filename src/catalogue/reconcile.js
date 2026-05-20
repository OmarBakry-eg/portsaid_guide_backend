// Targeted catalogue reconciliation.
//
// Compares the set of place IDs currently in `places/` against the
// set of place IDs currently surfaced anywhere in `catalogue_buckets/*`
// and uses hotInsertPlaceIntoCatalogue() to splice in any missing
// entries. Used to recover from:
//   - Historical approvals made BEFORE the hot-insert code was shipped
//     (the place doc exists but never landed in a bucket).
//   - Approvals where the hot-insert silently failed (network blip,
//     Firestore quota during the write phase, etc.).
//   - Direct Firestore edits to source_categories that should change
//     bucket membership.
//
// What this is NOT:
//   - A full rebuild (use `src/rebuild-catalogue.js` for that — wipes
//     + regenerates from scratch).
//   - A re-classifier (admin-pinned + scraped classifications are
//     kept untouched).
//
// Cost: 1 collection-read of places/ + 1 collection-read of
// catalogue_buckets/* up front, then ~2 reads + 2 writes per
// place that needs reconciling. For typical reconciles the
// recover-set is single-digit, so the operation costs <50 reads/writes.

import { hotInsertPlaceIntoCatalogue } from './hot-insert.js';
import { isAccepted } from '../parsers/scoring.js';

/// Scan places/ ↔ catalogue_buckets/* and bring buckets up to date
/// for every place that's missing.
///
/// Filters out places that don't pass `isAccepted()` (no coords / out
/// of bbox / missing title). Those are kept in places/ for historical
/// record but never surfaced to users; reconciling them would add
/// junk to user-facing buckets.
///
/// Returns an audit summary:
///   {
///     places_total: int,           // how many docs in places/
///     bucketed_total: int,         // how many distinct place_ids in any bucket
///     missing_ids: string[],       // up to 50, for logging
///     reconciled: int,             // how many got hot-inserted
///     skipped_rejected: int,       // not in bbox / no coords / etc.
///     skipped_failed: int,         // hot-insert returned no targets
///   }
export async function reconcileCatalogue(db) {
  // 1. Snapshot every place doc.
  const placesSnap = await db.collection('places').get();
  const placesById = new Map();
  for (const doc of placesSnap.docs) {
    placesById.set(doc.id, { ...doc.data(), place_id: doc.id });
  }

  // 2. Snapshot every bucket and collect the union of place_ids in
  //    them. One sweep, no nested reads — cheap.
  const bucketsSnap = await db.collection('catalogue_buckets').get();
  const bucketedIds = new Set();
  for (const bucket of bucketsSnap.docs) {
    const data = bucket.data();
    const places = Array.isArray(data.places) ? data.places : [];
    for (const p of places) {
      if (p?.place_id) bucketedIds.add(p.place_id);
    }
  }

  // 3. For every place in places/ that's NOT bucketed, attempt a
  //    hot-insert. We filter out places that wouldn't pass
  //    `isAccepted` because they wouldn't appear to users via the
  //    cron scrape either — surfacing them now would be a regression.
  const missing = [];
  for (const [placeId, place] of placesById) {
    if (bucketedIds.has(placeId)) continue;
    missing.push(placeId);
  }

  let reconciled = 0;
  let skippedRejected = 0;
  let skippedFailed = 0;
  for (const placeId of missing) {
    const place = placesById.get(placeId);
    if (!isAccepted(place)) {
      skippedRejected++;
      continue;
    }
    try {
      const r = await hotInsertPlaceIntoCatalogue(db, place);
      if (r && Array.isArray(r.touched) && r.touched.length > 0) {
        reconciled++;
      } else {
        skippedFailed++;
      }
    } catch (e) {
      console.warn(`[reconcile] ${placeId} failed: ${e.message}`);
      skippedFailed++;
    }
  }

  return {
    places_total: placesById.size,
    bucketed_total: bucketedIds.size,
    missing_count: missing.length,
    missing_ids: missing.slice(0, 50),
    reconciled,
    skipped_rejected: skippedRejected,
    skipped_failed: skippedFailed,
  };
}
