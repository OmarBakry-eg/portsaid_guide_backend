// POST /places/:placeId/report (auth-gated)
// Body: { reason: string, note?: string }
// → Writes place_reports/{id} and emails the admin.
//
// The report doc denormalises the place's CURRENT state and the
// place's creator info at write time. This is intentional — if the
// place is later edited or deleted, the report still shows the
// admin exactly what the user saw at the moment of reporting, AND
// the admin sees which user originally added the place (when it's
// not a scraper-created entry).
//
// Denormalised fields written onto place_reports/{id}:
//   place_snapshot: {
//     title, type, primary_slug, address, phone, website,
//     thumbnail, rating, reviews, lat, lon,
//   }
//   place_created_via: 'scraper' | 'user_submission' | 'admin_manual'
//                    | 'admin_direct' | null
//   place_creator_uid: string | null      (when set on the place)
//   place_creator_email: string | null    (resolved from users/{uid})
//   place_creator_name: string | null
//   place_submission_id: string | null    (back-ref to the row that
//                                          created the place, if any)
//   reporter_name: string | null          (display name from users/uid)

import { sendReportEmail } from '../email.js';
import { getFirestore } from '../../pipeline/firestore.js';

// Shared Firestore client. pipeline/firestore.js owns the
// settings({ ignoreUndefinedProperties: true }) call — calling it
// twice in one process throws "Firestore has already been initialized".
const getDb = getFirestore;

const VALID_REASONS = new Set([
  'inaccurate_info',
  'closed_business',
  'wrong_category',
  'duplicate',
  'spam',
  'other',
]);

/// Pull just the public-display fields off a full place doc. Skips
/// the heavy stuff (photos_data, reviews_data, extensions, etc.)
/// that doesn't help the admin triage a complaint.
function snapshotPlace(place) {
  const coords = place.gps_coordinates;
  return {
    title: place.title || null,
    type: place.type || null,
    primary_slug: place.primary_slug || null,
    address: place.address || null,
    phone: place.phone || null,
    website: place.website || null,
    thumbnail: place.thumbnail || null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviews: typeof place.reviews === 'number' ? place.reviews : null,
    lat: typeof coords?.latitude === 'number' ? coords.latitude : null,
    lon: typeof coords?.longitude === 'number' ? coords.longitude : null,
    // source_categories is small + tells the admin which buckets
    // this place lives in — useful for triaging "wrong_category"
    // reports.
    source_categories: Array.isArray(place.source_categories)
        ? place.source_categories : [],
  };
}

/// Resolve the place's creator's user doc into a friendly subset.
/// Returns nulls when not user-created or the user doc is missing.
async function lookupCreator(db, place) {
  const creatorUid = place.created_by_uid || null;
  if (!creatorUid) return { uid: null, email: null, name: null };
  try {
    const userSnap = await db.collection('users').doc(creatorUid).get();
    if (!userSnap.exists) {
      return { uid: creatorUid, email: null, name: null };
    }
    const u = userSnap.data();
    return {
      uid: creatorUid,
      email: u.email || null,
      name: u.display_name || null,
    };
  } catch (_) {
    return { uid: creatorUid, email: null, name: null };
  }
}

/// Resolve the reporter's display_name from users/{uid} (the auth
/// token doesn't carry it). Cheap — one point-read.
async function lookupReporterName(db, uid) {
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return null;
    return userSnap.data().display_name || null;
  } catch (_) {
    return null;
  }
}

export function makeReportPlaceHandler() {
  return async function reportPlace(req, res) {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'unauthenticated' });
    const placeId = (req.params.placeId || '').toString();
    if (!placeId) {
      return res.status(400).json({ error: 'missing_place_id' });
    }
    const reason = (req.body?.reason || '').toString();
    const note = (req.body?.note || '').toString().slice(0, 2000);
    if (!VALID_REASONS.has(reason)) {
      return res.status(400).json({
        error: 'invalid_reason',
        message: `Reason must be one of: ${[...VALID_REASONS].join(', ')}`,
      });
    }
    const db = await getDb();
    const placeSnap = await db.collection('places').doc(placeId).get();
    if (!placeSnap.exists) {
      return res.status(404).json({ error: 'place_not_found' });
    }
    const place = { place_id: placeId, ...placeSnap.data() };

    // Parallel lookups for the denormalised context. Both are
    // best-effort — failure leaves nulls in the resolved fields and
    // the report still writes.
    const [creator, reporterName] = await Promise.all([
      lookupCreator(db, place),
      lookupReporterName(db, user.uid),
    ]);

    const now = new Date();
    const reportRef = db.collection('place_reports').doc();
    await reportRef.set({
      place_id: placeId,
      reported_by_uid: user.uid,
      reported_by_email: user.email || null,
      reporter_name: reporterName,
      reason,
      note: note || null,
      status: 'open',
      created_at: now,
      created_at_iso: now.toISOString(),
      // Rich context — captured at write time so a later edit /
      // delete of the place doesn't strand the admin without info.
      place_snapshot: snapshotPlace(place),
      place_created_via: place.created_via || 'scraper',
      place_creator_uid: creator.uid,
      place_creator_email: creator.email,
      place_creator_name: creator.name,
      place_submission_id: place.submission_id || null,
    });

    // Best-effort admin email.
    sendReportEmail({ user, place, reason, note }).catch((e) =>
      console.warn('report email failed:', e.message)
    );

    return res.status(200).json({
      ok: true,
      report_id: reportRef.id,
      message: 'Thanks — we\'ll review and follow up if needed.',
    });
  };
}
