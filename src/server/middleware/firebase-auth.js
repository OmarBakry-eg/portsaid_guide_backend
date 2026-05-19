// Firebase ID token verification middleware for the Express server.
//
// Mobile clients sign in via Firebase Auth (Google provider). On every
// auth-gated request they attach the user's ID token as
// `Authorization: Bearer <jwt>`. This middleware verifies the token
// with `firebase-admin/auth`, then exposes `req.user = { uid, email,
// name, picture }` for downstream handlers.
//
// Usage:
//
//   import { requireAuth, optionalAuth } from './middleware/firebase-auth.js';
//   app.post('/places/submit', requireAuth(), submitPlace);
//   app.get('/places/feed', optionalAuth(), placesFeed);
//
// `requireAuth()` returns 401 on missing / invalid token.
// `optionalAuth()` populates `req.user` when present, no-ops otherwise.

import { existsSync } from 'node:fs';

let _adminAuthPromise = null;

/// Lazy-init the firebase-admin Auth client. Reuses the same service
/// account JSON the rest of the server uses (GOOGLE_APPLICATION_-
/// CREDENTIALS). Initialised once per process.
async function getAdminAuth() {
  if (_adminAuthPromise) return _adminAuthPromise;
  _adminAuthPromise = (async () => {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error(
        'Set GOOGLE_APPLICATION_CREDENTIALS env var to the service account JSON path.'
      );
    }
    if (!existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      throw new Error(
        `Service account file not found: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`
      );
    }
    const admin = await import('firebase-admin');
    if (!admin.default.apps.length) {
      admin.default.initializeApp({
        credential: admin.default.credential.applicationDefault(),
        projectId: process.env.FIRESTORE_PROJECT,
      });
    }
    return admin.default.auth();
  })();
  return _adminAuthPromise;
}

/// Parses `Authorization: Bearer <token>`. Returns the raw token or
/// null when the header is missing / malformed.
function extractBearer(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/// Verifies the bearer token. Throws on any failure (caller chooses
/// what to do with that). Returns the decoded token (uid, email, …).
async function verifyToken(token) {
  const auth = await getAdminAuth();
  return auth.verifyIdToken(token);
}

/// Hard-required auth. Use on endpoints that MUST have a signed-in
/// user (place submission, support contact, report-issue). 401s on
/// any failure with a generic error body — never leaks the verifier's
/// internal reason.
export function requireAuth() {
  return async (req, res, next) => {
    const token = extractBearer(req);
    if (!token) {
      return res.status(401).json({
        error: 'unauthenticated',
        message: 'Missing Authorization: Bearer <id_token> header.',
      });
    }
    try {
      const decoded = await verifyToken(token);
      req.user = {
        uid: decoded.uid,
        email: decoded.email || null,
        name: decoded.name || null,
        picture: decoded.picture || null,
        provider: 'google.com',
      };
      next();
    } catch (e) {
      return res.status(401).json({
        error: 'invalid_token',
        message: 'ID token rejected by Firebase Auth.',
      });
    }
  };
}

/// Soft auth — populates `req.user` when a valid token is present,
/// otherwise leaves it undefined and continues. Useful for endpoints
/// that personalise but don't require sign-in.
export function optionalAuth() {
  return async (req, res, next) => {
    const token = extractBearer(req);
    if (!token) return next();
    try {
      const decoded = await verifyToken(token);
      req.user = {
        uid: decoded.uid,
        email: decoded.email || null,
        name: decoded.name || null,
        picture: decoded.picture || null,
        provider: 'google.com',
      };
    } catch (_) {
      // Silently treat as unauthenticated — leave req.user undefined.
    }
    next();
  };
}
