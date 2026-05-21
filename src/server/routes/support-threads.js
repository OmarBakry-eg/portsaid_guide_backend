// Mobile-facing endpoints for the support thread system.
//
// Endpoints (all auth-gated, body is JSON):
//   POST /reports/:id/messages          → user posts a message
//   POST /reports/:id/mark-read         → user resets their unread count
//   POST /inquiries/:id/messages        → user posts a message
//   POST /inquiries/:id/mark-read       → user resets their unread count
//
// Reads happen via direct Firestore subscription from the mobile —
// it's the same pattern as user_notifications/{uid}/items: cheap,
// real-time, no server hop. The mobile listens on
// place_reports/{id}/messages (after verifying the user owns the
// parent doc).
//
// Why no GET here: the auth middleware would have to read the
// parent doc just to verify ownership before listing messages.
// Firestore security rules + a direct client subscription do the
// same job for free.

import { getFirestore } from '../../pipeline/firestore.js';
import {
  postMessage,
  markThreadRead,
  requestReopen,
} from '../support-messages.js';

function makeHandler(parentCollection, op) {
  return async function userSupportHandler(req, res) {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ ok: false, error: 'unauthenticated' });
      }
      const db = await getFirestore();
      if (op === 'post') {
        const out = await postMessage({
          db,
          parentCollection,
          parentId: req.params.id,
          author: 'user',
          authorUid: uid,
          body: req.body?.body,
        });
        return res.json({ ok: true, ...out });
      } else if (op === 'mark-read') {
        await markThreadRead({
          db, parentCollection, parentId: req.params.id, side: 'user',
        });
        return res.json({ ok: true });
      } else if (op === 'request-reopen') {
        const out = await requestReopen({
          db,
          parentCollection,
          parentId: req.params.id,
          authorUid: uid,
          body: req.body?.body,
        });
        return res.json({ ok: true, ...out });
      }
      return res.status(400).json({ ok: false, error: 'bad op' });
    } catch (e) {
      console.error('[support-thread]', op, parentCollection,
          req.params?.id, '→', e.message);
      if (!res.headersSent) {
        const msg = (e.message || 'failed').toString();
        const code = /not the owner/.test(msg) ? 403
            : /not found/.test(msg) ? 404
            : 400;
        return res.status(code).json({ ok: false, error: msg });
      }
    }
  };
}

export function mountSupportThreads(app, { requireAuth }) {
  for (const [parent, parentCollection] of [
    ['reports', 'place_reports'],
    ['inquiries', 'place_inquiries'],
  ]) {
    app.post('/' + parent + '/:id/messages', requireAuth(),
        makeHandler(parentCollection, 'post'));
    app.post('/' + parent + '/:id/mark-read', requireAuth(),
        makeHandler(parentCollection, 'mark-read'));
    // User asks the team to reopen a resolved thread. Allowed once
    // ever per thread — second attempt returns 400.
    app.post('/' + parent + '/:id/request-reopen', requireAuth(),
        makeHandler(parentCollection, 'request-reopen'));
  }
}
