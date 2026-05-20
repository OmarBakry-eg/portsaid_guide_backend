// Read-side queries the dashboard's JSON API uses. Distinct from
// admin-actions.js (which mutates) — keeps the responsibility split
// clean and the imports small per file.

import { getFirestore } from '../../pipeline/firestore.js';

// Shared Firestore client. pipeline/firestore.js owns the
// settings({ ignoreUndefinedProperties: true }) call; calling it
// twice in a process throws "Firestore has already been initialized".
const getDb = getFirestore;

/// Server-side cache of the slim "place row" projection the dashboard
/// table needs. Without this, every dashboard search had to pull the
/// FULL `places/` collection from Firestore (4.4k reads per search) to
/// even consider a substring match — and the previous behaviour was
/// worse, fetching only the first 200 alphabetically (so "ZAK." was
/// permanently invisible).
///
/// TTL: 5 minutes. Approvals via /omar-dash invalidate it eagerly so
/// admins see their freshly-approved places without waiting; other
/// changes (catalogue rebuild, direct Firestore edits) catch up at
/// the TTL boundary.
let _placesCache = null;
let _placesCacheAt = 0;
const PLACES_CACHE_TTL_MS = 5 * 60 * 1000;

/// Build the row projection from a Firestore doc. Same shape the old
/// listPlaces returned, so the dashboard UI doesn't need to change.
function rowFromDoc(d) {
  const p = d.data();
  return {
    place_id: d.id,
    title: p.title,
    type: p.type,
    primary_slug: p.primary_slug,
    source_categories: p.source_categories || [],
    rating: p.rating,
    reviews: p.reviews,
    thumbnail: p.thumbnail,
    lat: p.gps_coordinates?.latitude,
    lon: p.gps_coordinates?.longitude,
    created_via: p.created_via || 'scraper',
    created_by_uid: p.created_by_uid || null,
    submission_id: p.submission_id || null,
  };
}

/// Force the cache to drop. Called from approveSubmission so the next
/// dashboard search sees the just-approved place even if it's still
/// inside the 5-min TTL.
export function invalidatePlacesCache() {
  _placesCache = null;
  _placesCacheAt = 0;
}

async function loadAllPlaceRows() {
  const fresh = Date.now() - _placesCacheAt < PLACES_CACHE_TTL_MS;
  if (_placesCache && fresh) return _placesCache;
  const db = await getDb();
  // No orderBy — every doc is needed so we want the full pass at
  // minimum read cost. The dashboard table does its own sorting on
  // the result.
  const snap = await db.collection('places').get();
  _placesCache = snap.docs.map(rowFromDoc);
  _placesCacheAt = Date.now();
  return _placesCache;
}

/// Filtered list of places for the dashboard table.
///
/// Filter semantics:
///   - `search`: case-insensitive substring on title OR type OR
///     primary_slug. Searches the FULL collection now (not just the
///     first N alphabetically — that was the bug that hid "ZAK.").
///   - `subSlug`: place.source_categories array-contains.
///   - `mainSlug`: any sub-slug owned by this main appears in
///     source_categories. Resolved against the bucket catalog.
///
/// Sort: title ascending, with null/empty titles sinking to the
/// bottom (matches the previous behaviour).
///
/// Limit applied AFTER filtering so a search for "ZAK." doesn't get
/// cut off by a low limit on the source set.
export async function listPlaces({
  mainSlug,
  subSlug,
  search,
  limit = 100,
}) {
  const rows = await loadAllPlaceRows();

  let filtered = rows;

  if (subSlug) {
    filtered = filtered.filter((p) =>
        Array.isArray(p.source_categories) &&
        p.source_categories.includes(subSlug));
  }

  if (mainSlug) {
    // Lazy import to avoid circular.
    const { MAIN_CATEGORIES } = await import('../../catalogue/bucket.js');
    const main = MAIN_CATEGORIES.find((m) => m.slug === mainSlug);
    if (main) {
      const subSet = new Set(main.subSlugs);
      filtered = filtered.filter((p) =>
          (p.source_categories || []).some((s) => subSet.has(s)));
    }
  }

  if (search) {
    const needle = search.toLowerCase();
    filtered = filtered.filter((p) => {
      if ((p.title || '').toLowerCase().includes(needle)) return true;
      if ((p.type || '').toLowerCase().includes(needle)) return true;
      if ((p.primary_slug || '').toLowerCase().includes(needle)) return true;
      // Substring against the place_id too — useful when an admin
      // pastes a hex pair from the submission detail panel.
      if ((p.place_id || '').toLowerCase().includes(needle)) return true;
      return false;
    });
  }

  // Title-asc sort with empties last. Title can be undefined on a
  // mid-write doc; default to '' so the comparator stays stable.
  filtered.sort((a, b) => {
    const ta = (a.title || '￿').toLowerCase();
    const tb = (b.title || '￿').toLowerCase();
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  return filtered.slice(0, limit);
}

/// List users by sign-up time (newest first). Includes a quick
/// submission count via a secondary query.
export async function listUsers({ limit = 100 }) {
  const db = await getDb();
  const snap = await db
      .collection('users')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get();
  // Counts via parallel aggregation reads. Each is cheap (server-
  // side count, ~1 read regardless of result size).
  const items = [];
  for (const doc of snap.docs) {
    const u = doc.data();
    items.push({
      uid: doc.id,
      email: u.email,
      display_name: u.display_name,
      photo_url: u.photo_url,
      created_at: u.created_at?.toDate?.()?.toISOString?.() || null,
      last_login_at: u.last_login_at?.toDate?.()?.toISOString?.() || null,
    });
  }
  // Attach submission counts in parallel.
  const counts = await Promise.all(
    items.map((u) =>
      db
          .collection('place_submissions')
          .where('submitted_by_uid', '==', u.uid)
          .count()
          .get()
          .then((c) => c.data().count)
          .catch(() => 0)
    )
  );
  for (let i = 0; i < items.length; i++) items[i].submission_count = counts[i];
  return items;
}

/// List place reports. Optional status filter (default open).
export async function listReports({ status = 'open', limit = 100 }) {
  const db = await getDb();
  let q = db
      .collection('place_reports')
      .orderBy('created_at', 'desc')
      .limit(limit);
  if (status && status !== 'all') {
    q = db
        .collection('place_reports')
        .where('status', '==', status)
        .orderBy('created_at', 'desc')
        .limit(limit);
  }
  const snap = await q.get();
  return snap.docs.map((d) => {
    const r = d.data();
    return {
      id: d.id,
      place_id: r.place_id,
      reported_by_uid: r.reported_by_uid,
      reported_by_email: r.reported_by_email,
      reason: r.reason,
      note: r.note,
      status: r.status,
      created_at: r.created_at_iso ||
          (r.created_at?.toDate?.()?.toISOString?.() || null),
    };
  });
}

/// List user inquiries. Each inquiry is a free-text question/concern
/// the user sent from the mobile app about one of their submitted /
/// approved / rejected places. Newest first.
export async function listInquiries({ status = 'open', limit = 100 }) {
  const db = await getDb();
  let q = db
      .collection('place_inquiries')
      .orderBy('created_at', 'desc')
      .limit(limit);
  if (status && status !== 'all') {
    q = db
        .collection('place_inquiries')
        .where('status', '==', status)
        .orderBy('created_at', 'desc')
        .limit(limit);
  }
  const snap = await q.get();
  return snap.docs.map((d) => {
    const r = d.data();
    return {
      id: d.id,
      user_uid: r.user_uid,
      user_email: r.user_email,
      user_name: r.user_name,
      place_id: r.place_id,
      submission_id: r.submission_id,
      subject: r.subject,
      body: r.body,
      status: r.status,
      created_at: r.created_at_iso ||
          (r.created_at?.toDate?.()?.toISOString?.() || null),
      resolved_at: r.resolved_at?.toDate?.()?.toISOString?.() || null,
      admin_response: r.admin_response || null,
    };
  });
}

/// Mark an inquiry as resolved. Optional `response` is stored so the
/// admin can keep a record of what they did — surfaced read-only on
/// the dashboard. (We don't email the user from here; if they want a
/// reply they should reach out from their mailto reply chain.)
export async function resolveInquiry(id, { response } = {}) {
  const db = await getDb();
  await db
      .collection('place_inquiries')
      .doc(id)
      .update({
        status: 'resolved',
        resolved_at: new Date(),
        admin_response: response ? String(response).trim().slice(0, 2000) : null,
      });
  return { id };
}

/// Mark a report as resolved.
export async function resolveReport(id) {
  const db = await getDb();
  await db
      .collection('place_reports')
      .doc(id)
      .update({ status: 'resolved', resolved_at: new Date() });
  return { id };
}

/// High-level counts for the Stats view. Each `.count()` is one
/// read regardless of result size, so this is cheap (~10 reads).
export async function getStats() {
  const db = await getDb();
  const [
    placesCount,
    usersCount,
    submissionsPending,
    submissionsApproved,
    submissionsRejected,
    submissionsDuplicate,
    reportsOpen,
    reportsResolved,
    inquiriesOpen,
    inquiriesResolved,
  ] = await Promise.all([
    db.collection('places').count().get(),
    db.collection('users').count().get(),
    db
        .collection('place_submissions')
        .where('status', '==', 'pending')
        .count()
        .get(),
    db
        .collection('place_submissions')
        .where('status', '==', 'approved')
        .count()
        .get(),
    db
        .collection('place_submissions')
        .where('status', '==', 'rejected')
        .count()
        .get(),
    db
        .collection('place_submissions')
        .where('status', '==', 'duplicate')
        .count()
        .get(),
    db
        .collection('place_reports')
        .where('status', '==', 'open')
        .count()
        .get(),
    db
        .collection('place_reports')
        .where('status', '==', 'resolved')
        .count()
        .get(),
    db
        .collection('place_inquiries')
        .where('status', '==', 'open')
        .count()
        .get()
        .catch(() => ({ data: () => ({ count: 0 }) })),
    db
        .collection('place_inquiries')
        .where('status', '==', 'resolved')
        .count()
        .get()
        .catch(() => ({ data: () => ({ count: 0 }) })),
  ]);
  return {
    places: placesCount.data().count,
    users: usersCount.data().count,
    submissions: {
      pending: submissionsPending.data().count,
      approved: submissionsApproved.data().count,
      rejected: submissionsRejected.data().count,
      duplicate: submissionsDuplicate.data().count,
    },
    reports: {
      open: reportsOpen.data().count,
      resolved: reportsResolved.data().count,
    },
    inquiries: {
      open: inquiriesOpen.data().count,
      resolved: inquiriesResolved.data().count,
    },
  };
}
