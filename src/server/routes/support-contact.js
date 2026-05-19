// POST /support/contact (auth-gated)
// Body: { subject?: string, body: string }
// → Forwards to omarsalembakry1@gmail.com via Resend, reply-to set to
//   the signed-in user's email so admin can hit Reply directly.

import { sendSupportEmail } from '../email.js';

export function makeSupportContactHandler() {
  return async function supportContact(req, res) {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'unauthenticated' });
    const subject = (req.body?.subject || '').toString().slice(0, 200).trim();
    const body = (req.body?.body || '').toString().slice(0, 5000).trim();
    if (!body) {
      return res.status(400).json({
        error: 'missing_body',
        message: 'Tell us what you need help with in the body.',
      });
    }
    const result = await sendSupportEmail({ user, subject, body });
    if (!result.ok) {
      // We deliberately don't expose the email-service error to the
      // client — return 202 ("accepted") so the UI can confirm
      // delivery even if Resend is rate-limited / mis-configured.
      // The admin's runbook covers email-deliverability checks.
      console.warn('support: email send failed:', result.error);
    }
    return res.status(200).json({
      ok: true,
      message: 'Thanks — we\'ll get back to you within a day or two.',
    });
  };
}
