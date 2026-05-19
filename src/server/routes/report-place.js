// POST /places/:placeId/report (auth-gated)
// Body: { reason: string, note?: string }
// → Writes place_reports/{id} and emails the admin.

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

    // Write the report row.
    const reportRef = db.collection('place_reports').doc();
    await reportRef.set({
      place_id: placeId,
      reported_by_uid: user.uid,
      reported_by_email: user.email || null,
      reason,
      note: note || null,
      status: 'open',
      created_at: new Date(),
      created_at_iso: new Date().toISOString(),
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
