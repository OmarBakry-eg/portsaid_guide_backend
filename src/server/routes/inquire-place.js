// POST /places/inquire  (auth-gated)
//
// User-initiated inquiry from the mobile app — typically "the title of
// my submitted place is wrong" or "the address is off, please update".
// Stores the inquiry to `place_inquiries/` so it shows up in the admin
// dashboard's Inquiries tab. The mobile ALSO opens a `mailto:` from
// the user's own mail client to omarsalembakry1@gmail.com, so the
// admin gets a notification email without us paying for an email
// service.
//
// Body shape:
//   {
//     place_id?: string,         // optional — the place the inquiry is about
//     submission_id?: string,    // optional — links inquiry back to a place_submissions row
//     subject: string,           // short topic (e.g. "Wrong title", "Address update")
//     body: string,              // free-text details
//   }
//
// Response:
//   { ok: true, inquiry_id: '<doc-id>' }
//
// Per-user rate limit: 5 inquiries/hour to prevent spam. Soft cap;
// we just count by uid + created_at without a composite index.

import { getFirestore } from '../../pipeline/firestore.js';

const HOURLY_INQUIRY_LIMIT = 5;
const MAX_SUBJECT_LEN = 120;
const MAX_BODY_LEN = 2000;

const getDb = getFirestore;

async function getHourlyCount(db, uid) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const snap = await db
      .collection('place_inquiries')
      .where('user_uid', '==', uid)
      .limit(50)
      .get();
  let n = 0;
  for (const doc of snap.docs) {
    const ts = doc.data().created_at_iso;
    if (typeof ts === 'string' && ts >= since) n++;
  }
  return n;
}

export function makeInquireHandler() {
  return async function inquireWrapped(req, res) {
    try {
      await inquire(req, res);
    } catch (e) {
      console.error(
        '[inquire-place] uid=', req.user?.uid,
        '→', e.stack || e
      );
      if (res.headersSent) return;
      return res.status(500).json({
        ok: false,
        reason: 'Inquiry failed. ' + (e.message || 'Unknown server error.'),
      });
    }
  };
}

async function inquire(req, res) {
  const uid = req.user?.uid;
  if (!uid) {
    return res.status(401).json({ ok: false, reason: 'unauthenticated' });
  }
  const subject = (req.body?.subject || '').toString().trim();
  const body = (req.body?.body || '').toString().trim();
  if (!subject || !body) {
    return res.status(400).json({
      ok: false,
      reason: 'subject and body are required',
    });
  }
  if (subject.length > MAX_SUBJECT_LEN || body.length > MAX_BODY_LEN) {
    return res.status(400).json({
      ok: false,
      reason: `subject ≤${MAX_SUBJECT_LEN} chars, body ≤${MAX_BODY_LEN} chars`,
    });
  }
  const placeId = req.body?.place_id
      ? String(req.body.place_id).trim().slice(0, 200)
      : null;
  const submissionId = req.body?.submission_id
      ? String(req.body.submission_id).trim().slice(0, 200)
      : null;

  const db = await getDb();
  const hourly = await getHourlyCount(db, uid);
  if (hourly >= HOURLY_INQUIRY_LIMIT) {
    return res.status(429).json({
      ok: false,
      reason:
          `You've sent ${hourly} inquiries in the last hour. Please wait a bit.`,
    });
  }

  // Resolve the user's email + display name from `users/{uid}` so the
  // admin dashboard can show "from: alice@example.com" without an
  // extra read at list time. Best-effort — if the user doc is missing,
  // the inquiry still goes through with email=null.
  let userEmail = null;
  let userName = null;
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.exists) {
      const u = userSnap.data();
      userEmail = u.email || null;
      userName = u.display_name || null;
    }
  } catch (_) {
    // Non-fatal — proceed without it.
  }

  const now = new Date();
  const ref = db.collection('place_inquiries').doc();
  await ref.set({
    user_uid: uid,
    user_email: userEmail,
    user_name: userName,
    place_id: placeId,
    submission_id: submissionId,
    subject,
    body,
    status: 'open',
    created_at: now,
    created_at_iso: now.toISOString(),
  });

  console.log(
    `[inquire-place] uid=${uid.slice(0, 8)} ` +
    `place=${placeId || '-'} subj="${subject.slice(0, 60)}" id=${ref.id}`
  );

  return res.status(200).json({ ok: true, inquiry_id: ref.id });
}
