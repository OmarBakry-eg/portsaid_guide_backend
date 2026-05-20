// /omar-dash — single-page admin dashboard for managing user-
// submitted places. Lives on the existing Express server (Render).
//
// Stack:
//   - Inline Basic-Auth middleware (no external dep) — earlier we
//     used express-basic-auth, but the npm package proved finicky on
//     Render with Express 5 / ESM (deploy-time install failures led
//     to module-not-found at boot → 500 on every request). The
//     inline version is ~25 lines and zero risk of dep drift.
//   - Server-rendered HTML using template literals (no jsx, no build)
//   - Tailwind via CDN play.tailwindcss.com for the dark glass theme
//   - Lucide icons inlined SVG from CDN
//   - Vanilla fetch() for client-side interactions
//
// Routes mounted under /omar-dash:
//   GET  /omar-dash                       → main HTML view (basic auth)
//   GET  /omar-dash/_health               → unprotected probe; reports
//                                          whether the module + all
//                                          imports loaded cleanly
//   GET  /omar-dash/api/submissions       → JSON of pending+history
//   GET  /omar-dash/api/submissions/:id   → full raw doc + URL re-parse
//   PATCH /omar-dash/api/submissions/:id  → edit allowed fields/manual
//   POST /omar-dash/api/submissions/:id/approve
//   POST /omar-dash/api/submissions/:id/reject
//   GET  /omar-dash/api/places?main=&sub=&search=
//   GET  /omar-dash/api/users
//   GET  /omar-dash/api/reports?status=
//   POST /omar-dash/api/reports/:id/resolve
//   GET  /omar-dash/api/stats

import {
  approveSubmission,
  rejectSubmission,
  listSubmissions,
  getSubmission,
  updateSubmission,
} from './admin-actions.js';
import {
  listPlaces,
  listUsers,
  listReports,
  resolveReport,
  listInquiries,
  resolveInquiry,
  getStats,
} from './admin-queries.js';
import { renderDashboardHtml } from './views/dashboard-html.js';

/// Admin credentials. Defaults match the product spec; env vars
/// override in production.
const ADMIN_EMAIL =
  process.env.OMAR_DASH_USER || 'omarsalembakry1@gmail.com';
const ADMIN_PASSWORD = process.env.OMAR_DASH_PASS || '123Omar#';
// ASCII-only — Express 5 / Node strictly validate header values
// against Latin-1, and the WWW-Authenticate realm becomes a header
// value. The em-dash here (U+2014) caused the no-auth path to throw
// inside res.set(), surfacing as a 500 in browsers (which send the
// first request without an Authorization header, so they hit this
// path on every cold visit).
const REALM = 'PortSaid Guide Admin';

/// Minimal HTTP Basic-Auth middleware. Reads `Authorization: Basic
/// base64(user:pass)`. On miss / mismatch sends 401 + a
/// `WWW-Authenticate` challenge so the browser prompts.
///
/// Inlining is intentional: avoids a small npm dep that surprised us
/// on Render (deploy-time failures caused dashboard 500s before).
function basicAuthGate(req, res, next) {
  const hdr =
    req.headers.authorization || req.headers.Authorization || '';
  const match =
    typeof hdr === 'string' ? hdr.match(/^Basic\s+(.+)$/i) : null;
  if (match) {
    let decoded;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf-8');
    } catch {
      decoded = '';
    }
    const sep = decoded.indexOf(':');
    if (sep > 0) {
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (user === ADMIN_EMAIL && pass === ADMIN_PASSWORD) {
        return next();
      }
    }
  }
  res.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
  res.status(401).type('text/plain').send(
    'Authentication required. Use the admin Gmail + password.'
  );
}

/// Tiny wrapper that catches handler errors and returns a JSON 500.
/// Express 5 propagates thrown async errors to the default handler,
/// which sends an HTML error page — useless for /api endpoints. This
/// wraps each handler in a try/catch that returns structured JSON.
function jsonHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error('[omar-dash]', req.method, req.path, '→', e.stack || e);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: e.message || String(e) });
      }
    }
  };
}

/// Mount the dashboard on the supplied Express app. Call once at
/// server start (after `express.json()` is wired).
export function mountDashboard(app) {
  // ── Unprotected health probe ──
  // No basic-auth. Confirms the module loaded + all sibling imports
  // resolved. If /omar-dash 500s but this returns 200, the issue
  // is in basicAuth / handler. If both 500, the module itself is
  // broken at import time.
  app.get('/omar-dash/_health', (_req, res) => {
    res.json({
      ok: true,
      module: 'dashboard',
      admin_email_set: !!process.env.OMAR_DASH_USER,
      admin_pass_set: !!process.env.OMAR_DASH_PASS,
      firestore_project: process.env.FIRESTORE_PROJECT || null,
      ts: new Date().toISOString(),
    });
  });

  // ── Main view (basic-auth gated) ──
  app.get('/omar-dash', basicAuthGate, (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(renderDashboardHtml());
    } catch (e) {
      console.error('[omar-dash] render failed:', e.stack || e);
      res
          .status(500)
          .type('text/plain')
          .send('Dashboard render failed: ' + (e.message || String(e)));
    }
  });

  // ── JSON API ──
  app.get(
    '/omar-dash/api/submissions',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const status = (req.query.status || 'pending').toString();
      const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
      const list = await listSubmissions({ status, limit });
      res.json({ ok: true, status, count: list.length, items: list });
    })
  );

  // Full raw submission doc (for the editor panel). Includes a re-
  // parsed URL view (lat/lon/hex hints) when scrape failed.
  app.get(
    '/omar-dash/api/submissions/:id',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const detail = await getSubmission(req.params.id);
      res.json({ ok: true, ...detail });
    })
  );

  // Patch a small whitelist of submission fields. Body shape:
  //   { extracted_title?, extracted_place_id?, admin_note?, manual?: {...} }
  // Manual sub-object accepts: title, place_id, type, primary_slug,
  // lat, lon, address, phone, thumbnail, rating, reviews,
  // source_categories. See ALLOWED_MANUAL_FIELDS in admin-actions.js.
  app.patch(
    '/omar-dash/api/submissions/:id',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const out = await updateSubmission(req.params.id, req.body || {});
      res.json({ ok: true, ...out });
    })
  );

  app.post(
    '/omar-dash/api/submissions/:id/approve',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const result = await approveSubmission(req.params.id, {
        adminNote: req.body?.note,
      });
      res.json({ ok: true, ...result });
    })
  );

  app.post(
    '/omar-dash/api/submissions/:id/reject',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const result = await rejectSubmission(req.params.id, {
        reason: req.body?.reason,
      });
      res.json({ ok: true, ...result });
    })
  );

  app.get(
    '/omar-dash/api/places',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const items = await listPlaces({
        mainSlug: req.query.main?.toString(),
        subSlug: req.query.sub?.toString(),
        search: req.query.search?.toString(),
        limit: Math.min(parseInt(req.query.limit || '100', 10), 500),
      });
      res.json({ ok: true, count: items.length, items });
    })
  );

  app.get(
    '/omar-dash/api/users',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const items = await listUsers({
        limit: Math.min(parseInt(req.query.limit || '100', 10), 500),
      });
      res.json({ ok: true, count: items.length, items });
    })
  );

  app.get(
    '/omar-dash/api/reports',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const items = await listReports({
        status: (req.query.status || 'open').toString(),
        limit: Math.min(parseInt(req.query.limit || '100', 10), 500),
      });
      res.json({ ok: true, count: items.length, items });
    })
  );

  app.post(
    '/omar-dash/api/reports/:id/resolve',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const out = await resolveReport(req.params.id);
      res.json({ ok: true, ...out });
    })
  );

  app.get(
    '/omar-dash/api/inquiries',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const items = await listInquiries({
        status: (req.query.status || 'open').toString(),
        limit: Math.min(parseInt(req.query.limit || '100', 10), 500),
      });
      res.json({ ok: true, count: items.length, items });
    })
  );

  app.post(
    '/omar-dash/api/inquiries/:id/resolve',
    basicAuthGate,
    jsonHandler(async (req, res) => {
      const out = await resolveInquiry(req.params.id, {
        response: req.body?.response,
      });
      res.json({ ok: true, ...out });
    })
  );

  app.get(
    '/omar-dash/api/stats',
    basicAuthGate,
    jsonHandler(async (_req, res) => {
      const stats = await getStats();
      res.json({ ok: true, ...stats });
    })
  );

  console.log(
    `◆ /omar-dash mounted (user=${ADMIN_EMAIL.replace(
      /(.{2}).+(@.+)/,
      '$1***$2'
    )})`
  );
}
