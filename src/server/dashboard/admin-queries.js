// Read-side queries the dashboard's JSON API uses. Distinct from
// admin-actions.js (which mutates) — keeps the responsibility split
// clean and the imports small per file.

import { getFirestore } from '../../pipeline/firestore.js';

// Shared Firestore client. pipeline/firestore.js owns the
// settings({ ignoreUndefinedProperties: true }) call; calling it
// twice in a process throws "Firestore has already been initialized".
const getDb = getFirestore;

/// Paged list of places in the catalogue. Optional filter by main
/// slug or sub slug. Returns shallow projection for the dashboard
/// table — never the full doc.
export async function listPlaces({
  mainSlug,
  subSlug,
  search,
  limit = 100,
  cursorPlaceId,
}) {
  const db = await getDb();
  let q = db.collection('places').orderBy('title').limit(limit);
  // Optional cursor for pagination by alphabetical title.
  if (cursorPlaceId) {
    const cursorSnap = await db.collection('places').doc(cursorPlaceId).get();
    if (cursorSnap.exists) q = q.startAfter(cursorSnap);
  }
  // Filter by sub slug if provided (cheapest).
  if (subSlug) {
    q = db
        .collection('places')
        .where('source_categories', 'array-contains', subSlug)
        .orderBy('title')
        .limit(limit);
  }
  const snap = await q.get();
  const places = snap.docs.map((d) => {
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
  });
  // Apply optional client-side filters that Firestore can't do
  // cheaply (substring search, mainSlug post-filter).
  let filtered = places;
  if (mainSlug) {
    // mainSlug doesn't live as a field on the doc — derive via the
    // bucket catalog (lazy import to avoid circular).
    const { MAIN_CATEGORIES } = await import('../../catalogue/bucket.js');
    const main = MAIN_CATEGORIES.find((m) => m.slug === mainSlug);
    if (main) {
      const subSet = new Set(main.subSlugs);
      filtered = filtered.filter((p) =>
        (p.source_categories || []).some((s) => subSet.has(s))
      );
    }
  }
  if (search) {
    const needle = search.toLowerCase();
    filtered = filtered.filter((p) =>
      (p.title || '').toLowerCase().includes(needle)
    );
  }
  return filtered;
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
