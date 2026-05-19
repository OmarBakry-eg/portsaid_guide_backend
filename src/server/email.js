// Resend-backed transactional email sender.
//
// Use cases:
//   - Support contact (user → admin)
//   - Report-an-issue (user → admin, with place context)
//   - Submission decision (admin → user) — sent from the dashboard
//     when admin approves / rejects a pending submission.
//
// Env vars:
//   RESEND_API_KEY — required. Get from https://resend.com.
//   EMAIL_FROM     — optional; defaults to a sensible from address
//                    using Resend's onboarding domain. Override with
//                    your verified sending domain in production.
//   ADMIN_EMAIL    — where support/report emails go.
//                    Defaults to omarsalembakry1@gmail.com.
//
// Resend's free tier is 100 emails/day / 3,000/month — plenty for
// support volume + submission decisions at this scale.
//
// All sends are best-effort: if RESEND_API_KEY is missing or the
// API errors, we log and return without throwing — the caller's
// happy path doesn't depend on email delivery (the in-app status
// stream on the user's profile page is the source of truth).

const FROM_DEFAULT = process.env.EMAIL_FROM || 'PortSaid Guide <onboarding@resend.dev>';
const ADMIN_DEFAULT = process.env.ADMIN_EMAIL || 'omarsalembakry1@gmail.com';

let _resendPromise = null;

/// Lazy-init the Resend client. Skipped entirely when RESEND_API_KEY
/// isn't set — returns null and the calling code logs + no-ops.
async function getClient() {
  if (_resendPromise !== null) return _resendPromise;
  _resendPromise = (async () => {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.warn('email: RESEND_API_KEY not set — emails disabled');
      return null;
    }
    try {
      const { Resend } = await import('resend');
      return new Resend(key);
    } catch (e) {
      console.warn('email: failed to load resend client:', e.message);
      return null;
    }
  })();
  return _resendPromise;
}

/// Low-level send. Returns { ok, id?, error? }. Never throws.
async function send({ to, subject, html, text, replyTo }) {
  const client = await getClient();
  if (!client) {
    return { ok: false, error: 'resend not configured' };
  }
  try {
    const { data, error } = await client.emails.send({
      from: FROM_DEFAULT,
      to,
      subject,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
    });
    if (error) {
      console.warn('email: send failed:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    console.warn('email: exception during send:', e.message);
    return { ok: false, error: e.message };
  }
}

/// Generic styled email shell. Keeps formatting consistent across all
/// outgoing messages — sunset gradient header, body box, footer.
function shell({ heading, body }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f7; margin: 0; padding: 24px;">
    <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.06);">
      <div style="padding: 20px 24px; background: linear-gradient(135deg, #ff9555, #ff6b9d); color: white;">
        <h1 style="margin: 0; font-size: 18px; font-weight: 800;">PortSaid Guide</h1>
        <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">${heading}</p>
      </div>
      <div style="padding: 24px; color: #333; line-height: 1.5; font-size: 14px;">
        ${body}
      </div>
      <div style="padding: 14px 24px; background: #fafafa; border-top: 1px solid #eee; font-size: 11px; color: #888;">
        Sent by PortSaid Guide. Reply directly to this email to reach the admin.
      </div>
    </div>
  </body></html>`;
}

/// User → admin: support contact.
export async function sendSupportEmail({ user, subject, body }) {
  const safeSubject = (subject || 'Support request').slice(0, 120);
  const html = shell({
    heading: 'New support message',
    body:
      `<p><strong>From:</strong> ${escapeHtml(user.name || '(no name)')} ` +
      `&lt;${escapeHtml(user.email || '?')}&gt;</p>` +
      `<p><strong>UID:</strong> <code>${escapeHtml(user.uid)}</code></p>` +
      `<p><strong>Subject:</strong> ${escapeHtml(safeSubject)}</p>` +
      `<hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">` +
      `<div style="white-space: pre-wrap; background: #fafafa; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 13px;">${escapeHtml(
        body
      )}</div>`,
  });
  return send({
    to: ADMIN_DEFAULT,
    subject: `[Support] ${safeSubject}`,
    html,
    text: `Support from ${user.email}\n\n${body}`,
    replyTo: user.email || undefined,
  });
}

/// User → admin: report-an-issue on a specific place.
export async function sendReportEmail({ user, place, reason, note }) {
  const html = shell({
    heading: 'Place report',
    body:
      `<p><strong>From:</strong> ${escapeHtml(user.name || '(no name)')} ` +
      `&lt;${escapeHtml(user.email || '?')}&gt;</p>` +
      `<p><strong>Place:</strong> ${escapeHtml(place.title)} ` +
      `<code>(${escapeHtml(place.place_id)})</code></p>` +
      `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` +
      (note
        ? `<div style="white-space: pre-wrap; background: #fafafa; padding: 12px; border-radius: 8px; margin-top: 12px;">${escapeHtml(
            note
          )}</div>`
        : ''),
  });
  return send({
    to: ADMIN_DEFAULT,
    subject: `[Report] ${place.title} — ${reason}`,
    html,
    text: `${user.email} reports place ${place.place_id}: ${reason}\n\n${note ?? ''}`,
    replyTo: user.email || undefined,
  });
}

/// Admin → user: submission decision (approve / reject).
export async function sendSubmissionDecisionEmail({
  toEmail,
  decision,
  placeTitle,
  reason,
}) {
  const isApproved = decision === 'approved';
  const heading = isApproved
    ? '✅ Your submission was approved'
    : 'Your submission was reviewed';
  const body = isApproved
    ? `<p>Great news! Your submission <strong>${escapeHtml(
        placeTitle || 'the place'
      )}</strong> has been approved and is now live on PortSaid Guide.</p>` +
      `<p>Open the app to find it under its main category. Thanks for contributing!</p>`
    : `<p>Your submission <strong>${escapeHtml(
        placeTitle || 'the place'
      )}</strong> didn't make it to the catalogue.</p>` +
      (reason
        ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>`
        : '') +
      `<p>You can submit again with a different link if you think this was a mistake.</p>`;
  return send({
    to: toEmail,
    subject: heading,
    html: shell({ heading, body }),
    text: isApproved
      ? `Your submission for ${placeTitle} was approved.`
      : `Your submission for ${placeTitle} was rejected. ${reason ?? ''}`,
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
