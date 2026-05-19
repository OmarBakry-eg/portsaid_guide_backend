// /omar-dash — single-page admin dashboard for managing user-
// submitted places. Lives on the existing Express server (Render).
//
// Stack:
//   - express-basic-auth for the /omar-dash gate
//   - Server-rendered HTML using template literals (no jsx, no build)
//   - Tailwind via CDN play.tailwindcss.com for the dark glass theme
//   - Lucide icons inlined SVG from CDN
//   - Vanilla fetch() for client-side interactions (approve / reject /
//     refresh)
//
// Why this stack: zero build step, mounts cleanly inside the existing
// Express app, easy to ship from Render without a separate process.
//
// Routes mounted under /omar-dash:
//   GET  /omar-dash                       → main view (pending queue)
//   GET  /omar-dash/api/submissions       → JSON of pending+history
//   POST /omar-dash/api/submissions/:id/approve  → admin action
//   POST /omar-dash/api/submissions/:id/reject   → admin action
//   GET  /omar-dash/static/*              → static assets (CSS/JS)

import basicAuth from 'express-basic-auth';

import {
  approveSubmission,
  rejectSubmission,
  listSubmissions,
} from './admin-actions.js';
import {
  listPlaces,
  listUsers,
  listReports,
  resolveReport,
  getStats,
} from './admin-queries.js';
import { renderDashboardHtml } from './views/dashboard-html.js';

/// Admin credentials. These match what the user specified in the
/// product spec: `omarsalembakry1@gmail.com / 123Omar#`. Use env-var
/// overrides when set so the credential rotates easily in production.
const ADMIN_EMAIL =
  process.env.OMAR_DASH_USER || 'omarsalembakry1@gmail.com';
const ADMIN_PASSWORD = process.env.OMAR_DASH_PASS || '123Omar#';

/// Mount the dashboard on the supplied Express app. Call once at
/// server start (after `express.json()` is wired and `requireAuth()`
/// middleware imported, but before catch-all 404).
export function mountDashboard(app) {
  const gate = basicAuth({
    users: { [ADMIN_EMAIL]: ADMIN_PASSWORD },
    challenge: true,
    realm: 'PortSaid Guide — Admin',
    unauthorizedResponse: () =>
      'Authentication required. Use your admin Gmail + password.',
  });

  // Main dashboard view. Pre-renders with no data; the page itself
  // calls the JSON API to populate. Keeps the HTML cacheable.
  app.get('/omar-dash', gate, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(renderDashboardHtml());
  });

  // JSON API: list submissions with optional status filter.
  // Query params:
  //   ?status=pending|approved|rejected|duplicate (default: pending)
  //   ?limit=50 (default 100; max 500)
  app.get('/omar-dash/api/submissions', gate, async (req, res) => {
    try {
      const status = (req.query.status || 'pending').toString();
      const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
      const list = await listSubmissions({ status, limit });
      res.json({ ok: true, status, count: list.length, items: list });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Approve action.
  app.post(
    '/omar-dash/api/submissions/:id/approve',
    gate,
    async (req, res) => {
      try {
        const result = await approveSubmission(req.params.id, {
          adminNote: req.body?.note,
        });
        res.json({ ok: true, ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    }
  );

  // Reject action.
  app.post(
    '/omar-dash/api/submissions/:id/reject',
    gate,
    async (req, res) => {
      try {
        const result = await rejectSubmission(req.params.id, {
          reason: req.body?.reason,
        });
        res.json({ ok: true, ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    }
  );

  // ── Phase E: places / users / reports / stats endpoints ─────────────

  // GET /omar-dash/api/places?main=&sub=&search=&limit=
  app.get('/omar-dash/api/places', gate, async (req, res) => {
    try {
      const items = await listPlaces({
        mainSlug: req.query.main?.toString(),
        subSlug: req.query.sub?.toString(),
        search: req.query.search?.toString(),
        limit: Math.min(parseInt(req.query.limit || '100', 10), 500),
      });
      res.json({ ok: true, count: items.length, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /omar-dash/api/users?limit=
  app.get('/omar-dash/api/users', gate, async (req, res) => {
    try {
      const items = await listUsers({
        limit: Math.min(parseInt(req.query.limit || '100', 10), 500),
      });
      res.json({ ok: true, count: items.length, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /omar-dash/api/reports?status=open
  app.get('/omar-dash/api/reports', gate, async (req, res) => {
    try {
      const items = await listReports({
        status: (req.query.status || 'open').toString(),
        limit: Math.min(parseInt(req.query.limit || '100', 10), 500),
      });
      res.json({ ok: true, count: items.length, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /omar-dash/api/reports/:id/resolve
  app.post('/omar-dash/api/reports/:id/resolve', gate, async (req, res) => {
    try {
      const out = await resolveReport(req.params.id);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /omar-dash/api/stats
  app.get('/omar-dash/api/stats', gate, async (_req, res) => {
    try {
      const stats = await getStats();
      res.json({ ok: true, ...stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  console.log(
    `◆ /omar-dash mounted (admin user: ${ADMIN_EMAIL.replace(/(.{2}).+(@.+)/, '$1***$2')})`
  );
}
