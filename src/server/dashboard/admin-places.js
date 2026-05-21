// Admin CRUD on `places/`. Three operations:
//
//   createPlace(input)         → POST /omar-dash/api/places
//   updatePlace(id, patch)     → PATCH /omar-dash/api/places/:id
//   deletePlace(id)            → DELETE /omar-dash/api/places/:id
//
// Each operation also keeps `catalogue_buckets/*` and
// `catalogue_meta/index` in sync, so the mobile sees the change on
// the next Firestore snapshot — no cron scrape wait.
//
// Why the createPlace / approveSubmission split:
//   approveSubmission is tied to a place_submissions row and writes
//   provenance (created_by_uid, submission_id, etc.). createPlace
//   here is for the admin's "I'm adding this place directly from
//   nowhere" workflow — sets created_via='admin_direct', no submission
//   back-ref, no user notification (no submitter to notify).

import { getFirestore } from '../../pipeline/firestore.js';
import { enrichWithScores } from '../../parsers/scoring.js';
import { hotInsertPlaceIntoCatalogue } from '../../catalogue/hot-insert.js';
import {
  removePlaceFromAllBuckets,
  syncPlaceToCatalogue,
} from '../../catalogue/bucket-ops.js';
import { invalidatePlacesCache } from './admin-queries.js';

const getDb = getFirestore;

/// Fields the admin can set on create OR patch. The list is the same
/// for both — anything outside this set is silently dropped to keep
/// the place doc clean (e.g. an admin can't accidentally add a
/// `gps_coordinates` mistyped as `gps`).
const ALLOWED_FIELDS = new Set([
  'title',
  'type',
  'primary_slug',
  'source_categories',
  'address',
  'phone',
  'website',
  'thumbnail',
  'rating',
  'reviews',
  'price',
  // Coords accepted as flat lat/lon — coerced to gps_coordinates
  // before write so the doc matches the scrape schema.
  'lat',
  'lon',
]);

/// Normalise an incoming patch / create-input. Coerces types, drops
/// unknown keys, splits comma-separated source_categories.
function normalise(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    if (v == null || v === '') continue;
    if (k === 'lat' || k === 'lon' || k === 'rating') {
      const n = parseFloat(v);
      if (Number.isFinite(n)) out[k] = n;
    } else if (k === 'reviews') {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) out[k] = n;
    } else if (k === 'source_categories') {
      out[k] = Array.isArray(v)
          ? v.filter((s) => typeof s === 'string' && s.trim())
              .map((s) => s.trim())
          : String(v)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
    } else {
      out[k] = String(v).trim();
    }
  }
  return out;
}

/// Build a Firestore place doc from a normalised input. Caller has
/// already validated mandatory fields.
function buildPlaceDoc({ placeId, fields, prev = null }) {
  const now = new Date().toISOString();
  const lat = fields.lat ?? prev?.gps_coordinates?.latitude ?? null;
  const lon = fields.lon ?? prev?.gps_coordinates?.longitude ?? null;
  const sourceCategories = Array.isArray(fields.source_categories) &&
      fields.source_categories.length
      ? fields.source_categories
      : (fields.primary_slug
          ? [fields.primary_slug]
          : prev?.source_categories || []);

  // admin_pinned_fields: every field the admin TYPED is preserved on
  // future cron scrapes. We add to whatever was previously pinned
  // (admin previously set some fields, now changes more).
  const pinned = new Set(prev?.admin_pinned_fields || []);
  for (const f of [
    'title', 'type', 'address', 'phone', 'website',
    'primary_slug', 'thumbnail',
  ]) {
    if (fields[f] != null) pinned.add(f);
  }

  const doc = {
    place_id: placeId,
    title: fields.title ?? prev?.title ?? null,
    type: fields.type ?? prev?.type ?? null,
    address: fields.address ?? prev?.address ?? null,
    phone: fields.phone ?? prev?.phone ?? null,
    website: fields.website ?? prev?.website ?? null,
    thumbnail: fields.thumbnail ?? prev?.thumbnail ?? null,
    rating: fields.rating ?? prev?.rating ?? null,
    reviews: fields.reviews ?? prev?.reviews ?? null,
    price: fields.price ?? prev?.price ?? null,
    gps_coordinates: (typeof lat === 'number' && typeof lon === 'number')
        ? { latitude: lat, longitude: lon }
        : (prev?.gps_coordinates ?? null),
    primary_slug: fields.primary_slug ?? prev?.primary_slug ?? null,
    source_categories: sourceCategories,
    source_anchors: prev?.source_anchors || ['admin-direct'],
    first_seen_at: prev?.first_seen_at || now,
    last_seen_at: now,
    last_scraped_at: prev?.last_scraped_at || now,
    last_changed_at: now,
    last_scrape_run_id: prev?.last_scrape_run_id || 'admin-direct',
    created_by_uid: prev?.created_by_uid || null,
    created_via: prev?.created_via || 'admin_direct',
    submission_id: prev?.submission_id || null,
    admin_pinned_fields: [...pinned],
    classification: prev?.classification || {
      method: 'admin_direct',
      confidence: 1.0,
      reasoning: 'Admin created/edited place directly from dashboard.',
    },
    attributes: prev?.attributes || {},
  };

  // Drop nulls (Firestore-lean) and undefineds (Firestore rejects).
  for (const k of Object.keys(doc)) {
    if (doc[k] == null) delete doc[k];
  }
  // Compute weighted_rating / quality_score / sort_score.
  enrichWithScores(doc);
  // Defensive final undefined-strip.
  for (const k of Object.keys(doc)) {
    if (doc[k] === undefined) delete doc[k];
  }
  return doc;
}

/// Create a brand-new place doc.
///
/// Required fields: title, lat, lon, primary_slug.
/// Optional: type, address, phone, website, thumbnail, rating,
///           reviews, price, source_categories.
///
/// place_id is auto-generated (Firestore-style `direct-<rand>`) so it
/// can't collide with Google's hex pairs OR with admin-manual
/// submission ids.
export async function createPlace(input) {
  const fields = normalise(input);
  if (!fields.title) throw new Error('title is required');
  if (typeof fields.lat !== 'number' || typeof fields.lon !== 'number') {
    throw new Error('lat and lon are required');
  }
  if (!fields.primary_slug) {
    throw new Error('primary_slug is required');
  }
  const db = await getDb();
  // Generate a doc id that can't collide with Google hex pairs (which
  // never contain '-') or with admin-manual submission ids (prefixed
  // 'manual-'). 'direct-<rand>' is admin-created-from-scratch.
  const ref = db.collection('places').doc(
      'direct-' + Math.random().toString(36).slice(2, 12),
  );
  const doc = buildPlaceDoc({ placeId: ref.id, fields });
  await ref.set(doc);
  await hotInsertPlaceIntoCatalogue(db, doc).catch((e) =>
      console.warn('[admin-places] create hot-insert failed:', e.message));
  invalidatePlacesCache();
  return { place_id: ref.id, doc };
}

/// Patch an existing place. Merges incoming fields with the current
/// doc, recomputes scoring, then re-syncs catalogue buckets (handles
/// the case where primary_slug or source_categories changed, which
/// requires REMOVING from old buckets in addition to inserting into
/// new ones).
export async function updatePlace(placeId, patch) {
  if (!placeId) throw new Error('placeId is required');
  const fields = normalise(patch);
  if (Object.keys(fields).length === 0) {
    throw new Error('no editable fields in patch');
  }
  const db = await getDb();
  const ref = db.collection('places').doc(placeId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`place ${placeId} not found`);
  const prev = snap.data();
  const doc = buildPlaceDoc({ placeId, fields, prev });
  await ref.set(doc);
  // syncPlaceToCatalogue removes the place from every bucket then
  // hot-inserts against the new data. Idempotent + handles re-categorisation.
  await syncPlaceToCatalogue(db, doc).catch((e) =>
      console.warn('[admin-places] update sync failed:', e.message));
  invalidatePlacesCache();
  return { place_id: placeId, doc };
}

/// Delete a place. Removes from `places/` AND every bucket it lives
/// in. The catalogue index is refreshed so the mobile's home-page
/// counts drop immediately.
///
/// Returns { place_id, removed_from_buckets: string[] } so the
/// dashboard can confirm exactly what was touched.
export async function deletePlace(placeId) {
  if (!placeId) throw new Error('placeId is required');
  const db = await getDb();
  const ref = db.collection('places').doc(placeId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`place ${placeId} not found`);
  // Delete from places/ first. If the bucket cleanup fails afterwards,
  // we have a stale entry in some buckets but the place is gone —
  // the next /omar-dash → Reconcile (or scrape) will catch it.
  await ref.delete();
  const { touched } = await removePlaceFromAllBuckets(db, placeId);
  invalidatePlacesCache();
  return { place_id: placeId, removed_from_buckets: touched };
}
