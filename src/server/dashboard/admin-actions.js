// Admin action handlers for /omar-dash. Each reads a single
// place_submissions/{id} doc, performs the action, writes back.
//
// Side effect: on approve / reject, we email the submitter so they
// don't have to refresh the mobile app to learn the outcome. Email
// is best-effort; failure is logged but doesn't block the action.

import { sendSubmissionDecisionEmail } from '../email.js';
import { resolveUrl } from '../url-resolver.js';
import { enrichWithScores } from '../../parsers/scoring.js';
import { mainCategoryForSub } from '../../catalogue/main-of.js';
import { hotInsertPlaceIntoCatalogue } from '../../catalogue/hot-insert.js';
import {
  writeUserNotification,
  formatEditHeadline,
} from './notifications.js';
//
// Approve:
//   - Re-fetch the submitted URL's place if extracted_place_id is set
//     → already happened during submission; place is in places/.
//   - For pending submissions where extracted_place_id is null
//     (admin queue path), we'd need a manual re-fetch. For now,
//     approve only acts on submissions that have extracted_place_id
//     (i.e., the scrape resolved them).
//   - Promote the place: ensure created_by_uid / created_via /
//     submission_id back-ref are set on places/{place_id}.
//   - Mark submission status='approved', resolved_at=now,
//     resolved_by='admin'.
//
// Reject:
//   - Mark status='rejected', admin_note=reason, resolved_at=now,
//     resolved_by='admin'. If the place was already in places/ via
//     a previous approve, we do NOT delete it — only the submission
//     status updates. (Rare path; admin should use a separate
//     "delete place" tool for actual catalogue removal.)

import { getFirestore } from '../../pipeline/firestore.js';

// Shared Firestore client — settings() is owned by pipeline/firestore.js.
// Calling settings() twice in a process throws "Firestore has already
// been initialized" (the bug we used to hit on /omar-dash when this
// file ran AFTER something else had already configured Firestore).
const getDb = getFirestore;

/// List submissions for a given status, newest-first.
export async function listSubmissions({ status, limit = 100 }) {
  const db = await getDb();
  let q = db
      .collection('place_submissions')
      .orderBy('submitted_at', 'desc')
      .limit(limit);
  if (status && status !== 'all') {
    q = db
        .collection('place_submissions')
        .where('status', '==', status)
        .orderBy('submitted_at', 'desc')
        .limit(limit);
  }
  const snap = await q.get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      submitted_url: data.submitted_url,
      submitted_by_uid: data.submitted_by_uid,
      extracted_place_id: data.extracted_place_id || null,
      extracted_title: data.extracted_title || null,
      status: data.status,
      ai_verdict: data.ai_verdict || null,
      admin_note: data.admin_note || null,
      duplicate_of: data.duplicate_of || null,
      submitted_at: data.submitted_at_iso || (data.submitted_at?.toDate
          ? data.submitted_at.toDate().toISOString()
          : null),
      resolved_at: data.resolved_at?.toDate?.()?.toISOString?.() || null,
      resolved_by: data.resolved_by || null,
    };
  });
}

/// Return the full raw submission doc for the editor panel. Includes
/// every field stored on the doc, plus a re-parsed view of the
/// submitted URL (lat/lon/hex pair) — admins use that to prefill
/// manual edits when the scrape didn't produce title/place_id.
export async function getSubmission(id) {
  const db = await getDb();
  const ref = db.collection('place_submissions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`submission ${id} not found`);
  const raw = snap.data();

  // Serialise Firestore Timestamps to ISO strings so the JSON we send
  // to the browser is plain. We do this generically so any new field
  // (resolved_at, scraped_at, etc.) survives without code changes.
  const serialisable = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === 'object' && typeof v.toDate === 'function') {
      serialisable[k] = v.toDate().toISOString();
    } else {
      serialisable[k] = v;
    }
  }

  // Re-parse the URL so the panel can show lat/lon/hex hints — useful
  // when the scrape failed and the admin needs to fill those in. This
  // is cheap (no network unless it's a short link).
  let parsed = null;
  if (raw.submitted_url) {
    try {
      parsed = await resolveUrl(raw.submitted_url);
    } catch (e) {
      parsed = { error: e.message || String(e) };
    }
  }

  // Surface whether the resolved place_id (or manual override) is
  // already in places/ — drives the "Approve will reuse existing doc"
  // hint in the UI.
  let existingPlace = null;
  const candidatePlaceId =
      raw.extracted_place_id || raw.manual?.place_id || null;
  if (candidatePlaceId) {
    try {
      const placeSnap = await db
          .collection('places')
          .doc(candidatePlaceId)
          .get();
      if (placeSnap.exists) {
        const p = placeSnap.data();
        existingPlace = {
          place_id: placeSnap.id,
          title: p.title,
          type: p.type,
          primary_slug: p.primary_slug,
          source_categories: p.source_categories || [],
          rating: p.rating,
          reviews: p.reviews,
        };
      }
    } catch (_) {
      // Non-fatal — the panel can render without this.
    }
  }

  return {
    id,
    raw: serialisable,
    parsed_url: parsed,
    existing_place: existingPlace,
  };
}

/// Patch a submission doc. We only allow editing a small whitelist of
/// fields so an admin can't accidentally rewrite history (e.g.
/// `submitted_by_uid` or `submitted_at`). The `manual` sub-object is
/// the catch-all for fields that originally come from the scraper —
/// title / lat / lon / type / address / phone / primary_slug — and is
/// consumed by approveSubmission below when extracted_* is empty.
const ALLOWED_PATCH_FIELDS = new Set([
  'extracted_title',
  'extracted_place_id',
  'admin_note',
  'manual', // nested object; see normaliseManual()
]);

const ALLOWED_MANUAL_FIELDS = new Set([
  'title',
  'place_id',
  'type',
  'primary_slug',
  'lat',
  'lon',
  'address',
  'phone',
  'website',
  'thumbnail',
  'rating',
  'reviews',
  'source_categories', // array of sub-slugs
]);

function normaliseManual(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED_MANUAL_FIELDS.has(k)) continue;
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

export async function updateSubmission(id, patch) {
  if (!patch || typeof patch !== 'object') {
    throw new Error('patch body must be an object');
  }
  const db = await getDb();
  const ref = db.collection('place_submissions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`submission ${id} not found`);
  const before = snap.data();
  const existingManual = (before.manual && typeof before.manual === 'object')
      ? before.manual
      : {};

  // Track which manual fields actually changed so the notification
  // body can name them. Field added or value updated counts; field
  // removed (explicit null/empty) also counts.
  const changedFields = [];

  const update = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_PATCH_FIELDS.has(k)) continue;
    if (k === 'manual') {
      const incomingManual = normaliseManual(v);
      // Diff incoming vs existing.
      for (const [mk, mv] of Object.entries(incomingManual)) {
        if (existingManual[mk] !== mv) changedFields.push(mk);
      }
      // Merge into existing manual block rather than overwrite — lets
      // the admin save one field at a time without losing prior edits.
      update.manual = { ...existingManual, ...incomingManual };
    } else {
      const newVal = v == null ? null : String(v).trim();
      if (before[k] !== newVal) changedFields.push(k);
      update[k] = newVal;
    }
  }
  update.last_edited_at = new Date();
  await ref.update(update);

  // Best-effort: notify the submitter that their place was touched by
  // an admin. Only when status is still pending (approval/rejection
  // have their own dedicated notifications fired below). Debounce by
  // last_edited_at — if the admin saves twice in <60s we only ping
  // once.
  if (
      before.status === 'pending' &&
      changedFields.length > 0 &&
      before.submitted_by_uid
  ) {
    const lastEdited = before.last_edited_at?.toDate?.();
    const recentEdit = lastEdited && (Date.now() - lastEdited.getTime() < 60_000);
    if (!recentEdit) {
      const title = (update.manual?.title) ||
          before.extracted_title ||
          before.submitted_url ||
          'your submitted place';
      const headline = formatEditHeadline(title, changedFields);
      writeUserNotification(db, before.submitted_by_uid, {
        kind: 'submission_updated',
        title: headline,
        body:
            'Open the place from your profile to see the latest details.',
        place_id: (before.extracted_place_id || update.manual?.place_id) || null,
        submission_id: id,
        changed_fields: changedFields.slice(0, 10),
      });
    }
  }

  return { id, patched: Object.keys(update), changed_fields: changedFields };
}

/// Approve a submission. Two paths:
///
///   1. Scraper produced a place_id → the place already lives in
///      places/. We just tag it with submitter info + back-ref.
///
///   2. Scraper failed (extracted_place_id is null) but the admin
///      filled in a manual block → we synthesise a places/ doc from
///      the manual fields + URL geo, with a synthetic place_id of
///      'manual-<submissionId>'. The resulting doc has the same
///      schema-shape as a scraped place, so the mobile reads it
///      without special-casing.
///
/// Approve is idempotent: re-running it on an already-approved
/// submission just refreshes the back-refs.
export async function approveSubmission(id, { adminNote }) {
  const db = await getDb();
  const ref = db.collection('place_submissions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`submission ${id} not found`);
  const data = snap.data();
  const manual = (data.manual && typeof data.manual === 'object') ? data.manual : {};

  // Pick the place_id: extracted (from scrape) > manual override >
  // synthesised from the submission id. Synthesised ids are prefixed
  // 'manual-' so they're easy to spot in queries and so they can't
  // collide with Google's hex pairs (which never contain a dash).
  let placeId =
      data.extracted_place_id ||
      manual.place_id ||
      `manual-${id}`;

  const now = new Date();

  // Does the place already exist?
  const placeRef = db.collection('places').doc(placeId);
  const placeSnap = await placeRef.get();

  if (placeSnap.exists) {
    // Path 1 — back-ref onto existing doc.
    await placeRef.set(
      {
        created_by_uid: data.submitted_by_uid,
        created_via: 'user_submission',
        submission_id: id,
      },
      { merge: true }
    );
  } else {
    // Path 2 — synthesise the place doc from manual + extracted +
    // URL hints. Requires at minimum a title and coordinates so the
    // mobile renders the card + maps marker correctly.
    const parsed = data.submitted_url
        ? await resolveUrl(data.submitted_url).catch(() => null)
        : null;

    const lat =
        manual.lat ??
        parsed?.lat ??
        null;
    const lon =
        manual.lon ??
        parsed?.lon ??
        null;
    const title =
        manual.title ||
        data.extracted_title ||
        parsed?.name_hint ||
        null;

    if (!title) {
      throw new Error(
        'Cannot approve: no title. Fill in the title field, then try again.'
      );
    }
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      throw new Error(
        'Cannot approve: no coordinates. Fill in lat + lon (or paste a Maps URL that has them), then try again.'
      );
    }

    // Primary slug — required for the mobile catalogue to bucket this
    // place. If the admin didn't pick one, fall back to 'other' so
    // approving never blocks (the place lands in the Other tab and
    // can be re-classified later).
    const primarySlug =
        manual.primary_slug ||
        (manual.source_categories?.[0]) ||
        'other';
    const sourceCategories =
        Array.isArray(manual.source_categories) && manual.source_categories.length
            ? manual.source_categories
            : (primarySlug && primarySlug !== 'other' ? [primarySlug] : []);

    // Track which fields the admin explicitly set so the scraper merge
    // can preserve them on subsequent cron runs. Without this list,
    // mergePlace() can't tell which prev fields came from the scraper
    // vs from the dashboard. Title/address always count if set.
    const pinned = [];
    if (manual.title) pinned.push('title');
    if (manual.type) pinned.push('type');
    if (manual.address) pinned.push('address');
    if (manual.phone) pinned.push('phone');
    if (manual.website) pinned.push('website');
    if (manual.primary_slug) pinned.push('primary_slug');
    if (manual.thumbnail) pinned.push('thumbnail');

    const place = {
      place_id: placeId,
      title,
      type: manual.type || null,
      address: manual.address || null,
      phone: manual.phone || null,
      website: manual.website || null,
      thumbnail: manual.thumbnail || null,
      rating: manual.rating ?? null,
      reviews: manual.reviews ?? null,
      gps_coordinates: { latitude: lat, longitude: lon },
      primary_slug: primarySlug,
      source_categories: sourceCategories,
      source_anchors: ['admin-manual'],
      first_seen_at: now.toISOString(),
      last_seen_at: now.toISOString(),
      last_scraped_at: now.toISOString(),
      last_changed_at: now.toISOString(),
      last_scrape_run_id: 'admin-manual',
      created_by_uid: data.submitted_by_uid,
      created_via: 'admin_manual',
      submission_id: id,
      // Pinned fields → preserved across future scraper merges.
      admin_pinned_fields: pinned,
      classification: {
        method: 'admin_manual',
        confidence: 1.0,
        reasoning: 'Admin filled in fields manually from dashboard.',
      },
      attributes: {},
    };

    // Drop nulls so the doc stays lean, then attach derived scoring
    // fields (weighted_rating / quality_score / sort_score). Same
    // shape every other place in the store has, so the mobile sort
    // and quality filters keep working.
    for (const k of Object.keys(place)) if (place[k] == null) delete place[k];
    enrichWithScores(place);

    await placeRef.set(place);
  }

  // Mark submission approved + record the placeId we settled on (so a
  // re-approval picks the same id even if the manual fields change).
  await ref.update({
    status: 'approved',
    resolved_at: now,
    resolved_by: 'admin',
    extracted_place_id: placeId, // pin it
    admin_note: adminNote || null,
  });

  // Hot-insert into catalogue_buckets so the mobile sees the new
  // place in its category browse IMMEDIATELY. Without this, the
  // place sits in places/{id} but nobody finds it via the catalogue
  // until the next cron scrape rebuilds the buckets. Best-effort —
  // a failure here doesn't roll back the approval, it just delays
  // catalogue visibility until the next scrape.
  try {
    const finalSnap = await placeRef.get();
    if (finalSnap.exists) {
      const finalData = { ...finalSnap.data(), place_id: placeId };
      const hot = await hotInsertPlaceIntoCatalogue(db, finalData);
      console.log(
        `[approve] hot-inserted into buckets=${(hot.touched || []).join(',')}`
      );
    }
  } catch (e) {
    console.warn('[approve] hot-insert failed:', e.message);
  }

  // Best-effort notification email to the submitter. Resolves the
  // user's email from users/{uid} since the submission row only
  // stores the uid.
  const approvedTitle = data.extracted_title || manual.title || 'your place';
  notifyDecision(db, data.submitted_by_uid, 'approved', {
    placeTitle: approvedTitle,
    reason: adminNote,
  }).catch((e) => console.warn('approve-email failed:', e.message));

  // In-app notification — drops a row into
  // user_notifications/{uid}/items/, picked up by the mobile
  // NotificationsCubit's live stream and surfaced as a bell badge.
  writeUserNotification(db, data.submitted_by_uid, {
    kind: 'submission_approved',
    title: `Your place "${approvedTitle}" was approved!`,
    body: adminNote ||
        'It\'s now live in the PortSaid Guide catalogue for everyone to see.',
    place_id: placeId,
    submission_id: id,
  });

  return { id, place_id: placeId };
}

export async function rejectSubmission(id, { reason }) {
  const db = await getDb();
  const ref = db.collection('place_submissions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`submission ${id} not found`);
  const data = snap.data();
  const now = new Date();
  const adminNote = reason || 'Rejected by admin (no reason provided)';
  await ref.update({
    status: 'rejected',
    resolved_at: now,
    resolved_by: 'admin',
    admin_note: adminNote,
  });

  const rejectedTitle = data.extracted_title ||
      data.manual?.title ||
      data.submitted_url ||
      'your submission';

  notifyDecision(db, data.submitted_by_uid, 'rejected', {
    placeTitle: rejectedTitle,
    reason: reason || data.admin_note || null,
  }).catch((e) => console.warn('reject-email failed:', e.message));

  // In-app notification. The reason is surfaced in the notification
  // body verbatim so the user gets context without opening the app
  // (push) AND has it stored offline (Firestore cache).
  writeUserNotification(db, data.submitted_by_uid, {
    kind: 'submission_rejected',
    title: `Your submission for "${rejectedTitle}" was rejected`,
    body: adminNote,
    submission_id: id,
    admin_note: adminNote,
  });

  return { id };
}

/// Send the submission-decision email. Resolves the submitter's
/// email by reading users/{uid}.email — that was upserted by the
/// mobile on sign-in.
async function notifyDecision(db, uid, decision, { placeTitle, reason }) {
  if (!uid) return;
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return;
  const email = userSnap.data().email;
  if (!email) return;
  await sendSubmissionDecisionEmail({
    toEmail: email,
    decision,
    placeTitle,
    reason,
  });
}
