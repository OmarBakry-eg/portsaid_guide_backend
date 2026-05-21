// Read-side queries the dashboard's JSON API uses. Distinct from
// admin-actions.js (which mutates) — keeps the responsibility split
// clean and the imports small per file.

import { getFirestore } from '../../pipeline/firestore.js';
import { getStore } from './live-store.js';

// Shared Firestore client. pipeline/firestore.js owns the
// settings({ ignoreUndefinedProperties: true }) call; calling it
// twice in a process throws "Firestore has already been initialized".
const getDb = getFirestore;

// Helper used by the list endpoints — converts Firestore Timestamp
// values stored in the in-memory store back to ISO strings so the
// dashboard JSON serialiser doesn't choke. The streaming listener
// stores doc.data() verbatim (which still contains Timestamp
// objects); we don't want to walk every doc on every snapshot to
// normalise eagerly, so we do it on the read side per-row.
function tsIso(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v?.toDate === 'function') return v.toDate().toISOString();
  return null;
}

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
  // Zero Firestore reads: served from the in-memory streaming store
  // for `users/` + a single pass over the in-memory submissions
  // store to compute submission_count per user. Previously this
  // endpoint was a textbook N+1 (one read for the user list + one
  // count() aggregation per user) — for limit=200 that was ~400 reads
  // per click on the Users tab.
  const usersStore = await getStore('users');
  const subsStore = await getStore('place_submissions');

  // Tally submission counts by uid in one O(n) sweep.
  const countsByUid = new Map();
  for (const subData of subsStore.data.values()) {
    const uid = subData.submitted_by_uid;
    if (!uid) continue;
    countsByUid.set(uid, (countsByUid.get(uid) || 0) + 1);
  }

  // The streaming store is already ordered by created_at desc (the
  // listener subscribes with that orderBy), so slicing the front
  // gives us the newest N.
  const users = usersStore.all().slice(0, limit);
  return users.map((u) => ({
    uid: u.id,
    email: u.email,
    display_name: u.display_name,
    photo_url: u.photo_url,
    created_at: tsIso(u.created_at),
    last_login_at: tsIso(u.last_login_at),
    submission_count: countsByUid.get(u.id) || 0,
  }));
}

/// List place reports. Optional status filter (default open).
///
/// Zero per-request Firestore reads — augmented with place title +
/// creator-user info from the SAME in-memory streams. The dashboard
/// can render the full context (reported_by, reported_about, was
/// that place added by a user → who) without any Firestore round-
/// trips.
///
/// Returned per-report fields:
///   id, place_id, place_title, place_created_by_uid,
///   place_creator_email, place_creator_name,
///   reported_by_uid, reported_by_email,
///   reason, note, status, created_at,
///   last_message_*, admin_unread_count, user_unread_count
export async function listReports({ status = 'open', limit = 100 }) {
  const store = await getStore('place_reports');
  const usersStore = await getStore('users');
  // Look up reported places via the in-memory places cache (set by
  // listPlaces or the explicit invalidate/refresh path). On a cold
  // server, _placesCache may not be populated yet — we degrade
  // gracefully by leaving the place_* fields null in that case.
  const placesById = new Map();
  if (_placesCache) {
    for (const p of _placesCache) placesById.set(p.place_id, p);
  }
  const usersByUid = new Map();
  for (const u of usersStore.all()) usersByUid.set(u.id, u);

  const all = store.all();
  const filtered = (status && status !== 'all')
      ? all.filter((r) => r.status === status)
      : all;
  return filtered.slice(0, limit).map((r) => {
    const place = r.place_id ? placesById.get(r.place_id) : null;
    const creatorUid = place?.created_by_uid || null;
    const creator = creatorUid ? usersByUid.get(creatorUid) : null;
    return {
      id: r.id,
      place_id: r.place_id || null,
      // Augmented place info — gives the admin context about WHAT
      // is being reported without a click-through.
      place_title: place?.title || null,
      place_primary_slug: place?.primary_slug || null,
      place_created_via: place?.created_via || null,
      place_created_by_uid: creatorUid,
      place_creator_email: creator?.email || null,
      place_creator_name: creator?.display_name || null,
      // Reporter info.
      reported_by_uid: r.reported_by_uid || null,
      reported_by_email: r.reported_by_email || null,
      reason: r.reason || null,
      note: r.note || null,
      status: r.status,
      created_at: r.created_at_iso || tsIso(r.created_at),
      // Thread summary (denormalised from the messages sub-collection).
      last_message_at: r.last_message_at_iso || tsIso(r.last_message_at),
      last_message_author: r.last_message_author || null,
      last_message_preview: r.last_message_preview || null,
      admin_unread_count: r.admin_unread_count || 0,
      user_unread_count: r.user_unread_count || 0,
      resolved_at: tsIso(r.resolved_at),
      admin_response: r.admin_response || null,
    };
  });
}

/// List user inquiries. Each inquiry is a free-text question/concern
/// the user sent from the mobile app about one of their submitted /
/// approved / rejected places. Newest first.
/// Zero per-request Firestore reads.
export async function listInquiries({ status = 'open', limit = 100 }) {
  const store = await getStore('place_inquiries');
  // Look up referenced place (when present) so the dashboard can
  // show what the inquiry is about + who added that place.
  const placesById = new Map();
  if (_placesCache) {
    for (const p of _placesCache) placesById.set(p.place_id, p);
  }
  const usersStore = await getStore('users');
  const usersByUid = new Map();
  for (const u of usersStore.all()) usersByUid.set(u.id, u);

  const all = store.all();
  const filtered = (status && status !== 'all')
      ? all.filter((r) => r.status === status)
      : all;
  return filtered.slice(0, limit).map((r) => {
    const place = r.place_id ? placesById.get(r.place_id) : null;
    const creatorUid = place?.created_by_uid || null;
    const creator = creatorUid ? usersByUid.get(creatorUid) : null;
    return {
      id: r.id,
      user_uid: r.user_uid,
      user_email: r.user_email,
      user_name: r.user_name,
      place_id: r.place_id || null,
      place_title: place?.title || null,
      place_primary_slug: place?.primary_slug || null,
      place_created_via: place?.created_via || null,
      place_created_by_uid: creatorUid,
      place_creator_email: creator?.email || null,
      place_creator_name: creator?.display_name || null,
      submission_id: r.submission_id || null,
      subject: r.subject,
      body: r.body,
      status: r.status,
      created_at: r.created_at_iso || tsIso(r.created_at),
      resolved_at: tsIso(r.resolved_at),
      admin_response: r.admin_response || null,
      // Thread summary.
      last_message_at: r.last_message_at_iso || tsIso(r.last_message_at),
      last_message_author: r.last_message_author || null,
      last_message_preview: r.last_message_preview || null,
      admin_unread_count: r.admin_unread_count || 0,
      user_unread_count: r.user_unread_count || 0,
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

/// High-level counts for the Stats view.
///
/// Cost model: every count except `places` is derived from the in-
/// memory streaming store — ZERO Firestore reads. The places count
/// reads from the same 5-min TTL cache the dashboard's All Places
/// table uses (`listPlaces`-backing rows), so if the admin has
/// browsed places at all in the last 5 min the count is also free.
/// First Stats fetch after a server cold-start costs at most ~4,400
/// reads (the places-table cache fill) + 0 for everything else.
///
/// Previously: ~10 .count() aggregations per request = ~10 reads per
/// Stats tab open. Mathematically cheap, but tab-flipping by an
/// admin during a debug session added up — and the listener-derived
/// numbers update in real time while the old approach showed stale
/// counts for the duration of any debounced refresh.
export async function getStats() {
  const subs = await getStore('place_submissions');
  const reports = await getStore('place_reports');
  const inquiries = await getStore('place_inquiries');
  const users = await getStore('users');

  // For the `places` count we reuse the listPlaces in-memory cache.
  // If it's not warm yet we fall through to a single .count()
  // aggregation (1 read). On a busy dashboard this happens at most
  // once per 5 min.
  let placesCount = 0;
  if (_placesCache && Date.now() - _placesCacheAt < PLACES_CACHE_TTL_MS) {
    placesCount = _placesCache.length;
  } else {
    try {
      const db = await getDb();
      const c = await db.collection('places').count().get();
      placesCount = c.data().count;
    } catch (_) {
      placesCount = 0;
    }
  }

  return {
    places: placesCount,
    users: users.size(),
    submissions: {
      pending: subs.countWhere('status', 'pending'),
      approved: subs.countWhere('status', 'approved'),
      rejected: subs.countWhere('status', 'rejected'),
      duplicate: subs.countWhere('status', 'duplicate'),
    },
    reports: {
      open: reports.countWhere('status', 'open'),
      resolved: reports.countWhere('status', 'resolved'),
    },
    inquiries: {
      open: inquiries.countWhere('status', 'open'),
      resolved: inquiries.countWhere('status', 'resolved'),
    },
  };
}
