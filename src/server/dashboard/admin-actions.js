// Admin action handlers for /omar-dash. Each reads a single
// place_submissions/{id} doc, performs the action, writes back.
//
// Side effect: on approve / reject, we email the submitter so they
// don't have to refresh the mobile app to learn the outcome. Email
// is best-effort; failure is logged but doesn't block the action.

import { sendSubmissionDecisionEmail } from '../email.js';
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

let _dbPromise = null;

async function getDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    const admin = await import('firebase-admin');
    if (!admin.default.apps.length) {
      admin.default.initializeApp({
        credential: admin.default.credential.applicationDefault(),
        projectId: process.env.FIRESTORE_PROJECT,
      });
    }
    const db = admin.default.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    return db;
  })();
  return _dbPromise;
}

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

export async function approveSubmission(id, { adminNote }) {
  const db = await getDb();
  const ref = db.collection('place_submissions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`submission ${id} not found`);
  const data = snap.data();
  const placeId = data.extracted_place_id;
  if (!placeId) {
    throw new Error(
      'submission has no extracted_place_id — needs manual scrape before approval'
    );
  }
  const now = new Date();
  // Tag the place doc with the submitter + submission back-ref.
  await db.collection('places').doc(placeId).set(
    {
      created_by_uid: data.submitted_by_uid,
      created_via: 'user_submission',
      submission_id: id,
    },
    { merge: true }
  );
  // Mark submission approved.
  await ref.update({
    status: 'approved',
    resolved_at: now,
    resolved_by: 'admin',
    admin_note: adminNote || null,
  });

  // Best-effort notification email to the submitter. Resolves the
  // user's email from users/{uid} since the submission row only
  // stores the uid.
  notifyDecision(db, data.submitted_by_uid, 'approved', {
    placeTitle: data.extracted_title,
    reason: adminNote,
  }).catch((e) => console.warn('approve-email failed:', e.message));

  return { id, place_id: placeId };
}

export async function rejectSubmission(id, { reason }) {
  const db = await getDb();
  const ref = db.collection('place_submissions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`submission ${id} not found`);
  const data = snap.data();
  const now = new Date();
  await ref.update({
    status: 'rejected',
    resolved_at: now,
    resolved_by: 'admin',
    admin_note: reason || 'Rejected by admin (no reason provided)',
  });

  notifyDecision(db, data.submitted_by_uid, 'rejected', {
    placeTitle: data.extracted_title,
    reason: reason || data.admin_note || null,
  }).catch((e) => console.warn('reject-email failed:', e.message));

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
