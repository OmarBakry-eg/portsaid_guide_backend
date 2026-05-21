// POST /places/submit  (auth-gated)
//
// Mobile sends `{ url: '<google-maps-url>' }` plus a Firebase ID token.
// We resolve the URL, look up whether the place is already in our
// store, and decide one of four outcomes:
//
//   1. 'duplicate'  — already in places/. Return existing place data
//                    + breadcrumb (main slug / sub slug) so the mobile
//                    can render a "this place is already on PortSaid
//                    Guide" sheet with a Place card.
//   2. 'added'      — auto-classified above threshold + inside the
//                    Port Said bbox. Wrote to places/. Returns the
//                    new place data + breadcrumb.
//   3. 'pending'    — resolved but the AI's confidence isn't high
//                    enough OR the place is borderline geo. Goes to
//                    place_submissions/{id} with status=pending for
//                    admin review.
//   4. 'rejected'   — out-of-bbox, malformed URL, or otherwise
//                    obviously unusable. Logged to place_submissions
//                    with status=rejected, reason returned to user.
//
// Every outcome writes a place_submissions/{id} doc tagging the
// submitter — that's how the user's profile page tracks "their"
// places across all four outcome statuses.

import { resolveUrl } from '../url-resolver.js';
import { scrapePlaceDetails } from '../../scrapers/place-details.js';
import { mergePlace, applyScrape } from '../../pipeline/normalize.js';
import { classify } from '../../classifier/index.js';
import { isAccepted } from '../../parsers/scoring.js';
import { mainCategoryForSub } from '../../catalogue/main-of.js';
import { getFirestore } from '../../pipeline/firestore.js';

/// Per-user rate limit. Soft cap to prevent runaway scripts /
/// accidental flooding. 10/day per uid.
const DAILY_SUBMIT_LIMIT = 10;

/// Confidence floor for auto-adding without admin review. Lower than
/// the classifier's internal ASSIGN_SLUG floor because submission is
/// a different cost/benefit balance — we'd rather let humans triage
/// borderline cases than auto-publish them.
const AUTO_ADD_CONFIDENCE = 0.7;

// Uses the shared Firestore client from pipeline/firestore.js. That
// module owns the single `settings({ ignoreUndefinedProperties: true })`
// call — calling settings() from here would throw because Firestore
// only allows ONE settings() call per process. Previously this file
// (and every other handler) had its own getDb() with its own
// settings() call, which crashed under load when more than one
// handler had to talk to Firestore.
const getDb = getFirestore;

/// Check the submitter's rate limit. Returns the count of submissions
/// the user has made in the last 24 hours.
///
/// Implementation note: we do this as ONE single-field equality query
/// (`submitted_by_uid == uid`) plus a tight client-side filter on
/// `submitted_at_iso`. The old version used a TWO-where composite
/// query that required a manually-created Firestore composite index
/// ("9 FAILED_PRECONDITION: The query requires an index") — which
/// blocked every first-time submission on a fresh project. Single-
/// field equality uses the default per-field index that Firestore
/// auto-maintains, so no manual index step is needed.
///
/// Bounded fetch (`limit(200)`) so the query stays cheap even for a
/// user with thousands of historic submissions. 200 is well above
/// any realistic 24h window — at our cap of 10/day it'd take 20
/// days for an active user to fill, after which older entries drop
/// out of our `since` window naturally and the bound stays accurate.
async function getDailyCount(db, uid) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const snap = await db
      .collection('place_submissions')
      .where('submitted_by_uid', '==', uid)
      .limit(200)
      .get();
  let count = 0;
  for (const doc of snap.docs) {
    const ts = doc.data().submitted_at_iso;
    if (typeof ts === 'string' && ts >= since) count++;
  }
  return count;
}

/// Look up an EXISTING place by its identity. We deliberately do NOT
/// fall back to geo-proximity matching — that was a false-positive
/// trap. Real-world example that motivated the change: a user shared
/// "Prova" from Google Maps; the URL resolver gave us a valid hex
/// pair, but no existing place doc had that hex_pair. The OLD code
/// then ran a ~33 m radius scan and returned a totally different
/// Arabic restaurant nearby as a "duplicate." The user got an
/// `outcome: duplicate` for a place that wasn't actually theirs.
///
/// Strict matching now:
///   1. hex_pair → `cid_hex` field equality
///   2. hex_pair → doc id equality (newer ingestions store the hex
///      as the doc id; ChIJ-form ids also live under doc id)
///   3. If neither matches → null. The submission then proceeds as
///      a new place (scrape, classify, OR admin review).
///
/// A user submitting a real duplicate from a different URL form
/// (CID-only, no hex pair) will land in admin review where the
/// admin can spot it and reject.
async function findExistingPlace(db, { hexPair }) {
  if (!hexPair) return null;
  // (1) cid_hex field equality
  try {
    const directQ = await db
        .collection('places')
        .where('cid_hex', '==', hexPair)
        .limit(1)
        .get();
    if (!directQ.empty) {
      const doc = directQ.docs[0];
      return { id: doc.id, data: doc.data() };
    }
  } catch (_) {
    // No-op; fall through to doc-id check.
  }
  // (2) Doc id equality — covers the cases where the hex pair IS the
  // place_id (or close to it). Cheap point-read, single query.
  try {
    const byId = await db.collection('places').doc(hexPair).get();
    if (byId.exists) {
      return { id: byId.id, data: byId.data() };
    }
  } catch (_) {}
  return null;
}

/// Build the user-facing breadcrumb for a place: which main + sub
/// it lives under in the catalogue. Reads `source_categories` and
/// resolves the first curated slug to its main.
function breadcrumbFor(placeData) {
  const cats = Array.isArray(placeData?.source_categories)
      ? placeData.source_categories
      : [];
  for (const sub of cats) {
    const main = mainCategoryForSub(sub);
    if (main) return { main, sub };
  }
  return { main: 'other', sub: cats[0] ?? 'other' };
}

/// Write a record to place_submissions/. Returns the created doc id.
async function recordSubmission(db, payload) {
  const ref = db.collection('place_submissions').doc();
  await ref.set({
    ...payload,
    submitted_at: new Date(),
    submitted_at_iso: new Date().toISOString(),
  });
  return ref.id;
}

export function makeSubmitPlaceHandler() {
  // Wrap the real handler so any thrown error becomes a structured
  // JSON response instead of Express's generic 500 HTML. Without
  // this, Firestore quota exhaustion / scraper timeouts / etc. all
  // came back to the mobile as "HTTP 500" — totally opaque to the
  // user. Now they see the actual reason ("Quota exceeded — try
  // again tomorrow.", "Scrape timed out.", etc.).
  return async function submitPlaceWrapped(req, res) {
    try {
      await submitPlace(req, res);
    } catch (e) {
      console.error(
        '[submit-place] uid=', req.user?.uid,
        'url=', req.body?.url,
        '→', e.stack || e
      );
      if (res.headersSent) return;
      // Recognise Firestore's RESOURCE_EXHAUSTED code so we can return
      // a friendly message + 503 Service Unavailable (the right status
      // for a temporary backend dependency limit, not a 500).
      const isQuota =
          e?.code === 8 ||
          /RESOURCE_EXHAUSTED|Quota exceeded/i.test(e?.message || '');
      if (isQuota) {
        return res.status(503).json({
          outcome: 'error',
          reason:
            'Submissions are temporarily paused — our daily database read limit has been hit. Please try again in a few hours.',
          retry_after_hours: 24,
        });
      }
      return res.status(500).json({
        outcome: 'error',
        reason:
            'Submission failed. ' + (e.message || 'Unknown server error.'),
      });
    }
  };
}

/// Per-step debug logger. Use [submit-place uid=… step=…] tags so the
/// Render log viewer's text filter can isolate one submission's whole
/// trace easily.
function log(req, step, info) {
  const uid = (req.user?.uid || '?').slice(0, 8);
  const url = (req.body?.url || '').slice(0, 80);
  const extra = info ? ' | ' + JSON.stringify(info).slice(0, 280) : '';
  console.log(`[submit-place uid=${uid}] ${step} | url=${url}${extra}`);
}

async function submitPlace(req, res) {
    const uid = req.user?.uid;
    if (!uid) {
      console.log('[submit-place] reject: no uid');
      return res.status(401).json({ error: 'unauthenticated' });
    }
    const rawUrl = (req.body?.url || '').toString();
    const url = rawUrl.trim();
    if (!url) {
      log(req, 'reject: missing url');
      return res.status(400).json({
        error: 'missing_url',
        message: 'Pass `url` in the request body.',
      });
    }
    // Detailed input dump for real-device debugging. Logs the input
    // verbatim AND a hex dump of any non-ASCII characters — iOS
    // clipboards sometimes embed zero-width / RTL marks (U+200E etc.)
    // that survive trim() but make `new URL()` throw, so we want to
    // SEE them in Render logs when a real device fails where the
    // simulator works.
    const nonAscii = [];
    for (let i = 0; i < rawUrl.length; i++) {
      const code = rawUrl.charCodeAt(i);
      if (code < 0x20 || code > 0x7e) {
        nonAscii.push({ i, code: '0x' + code.toString(16) });
      }
    }
    log(req, 'start', {
      url_len: rawUrl.length,
      trimmed_len: url.length,
      non_ascii: nonAscii.slice(0, 8),
    });
    const db = await getDb();
    log(req, 'db ready');

    // Rate-limit before doing any expensive work.
    const dailyCount = await getDailyCount(db, uid);
    log(req, 'rate-limit check', { dailyCount, limit: DAILY_SUBMIT_LIMIT });
    if (dailyCount >= DAILY_SUBMIT_LIMIT) {
      return res.status(429).json({
        outcome: 'rate_limited',
        reason: `You've submitted ${dailyCount} places in the last 24 hours. Try again tomorrow.`,
        message: `You've submitted ${dailyCount} places in the last 24 hours. Try again tomorrow.`,
      });
    }

    // 1. Resolve URL → hex pair / coords / rejection.
    const parsed = await resolveUrl(url);
    log(req, 'resolveUrl done', { rejected: !!parsed.rejection, kind: parsed.kind, hex: parsed.place_hex_pair, apple: parsed.apple_place_id, lat: parsed.lat, lon: parsed.lon, name_hint: parsed.name_hint });
    if (parsed.rejection) {
      const submissionId = await recordSubmission(db, {
        submitted_url: url,
        submitted_by_uid: uid,
        status: 'rejected',
        admin_note: parsed.rejection,
        resolved_at: new Date(),
        resolved_by: 'auto',
      });
      return res.status(200).json({
        outcome: 'rejected',
        reason: parsed.rejection,
        submission_id: submissionId,
      });
    }

    // 2. Try to match against existing places/ before scraping.
    // Strict hex_pair matching only — see findExistingPlace doc-comment
    // for why we dropped geo-proximity.
    const existing = await findExistingPlace(db, {
      hexPair: parsed.place_hex_pair,
    });
    log(req, 'duplicate-check done', {
      found: !!existing,
      existing_id: existing?.id,
    });
    if (existing) {
      const submissionId = await recordSubmission(db, {
        submitted_url: url,
        submitted_by_uid: uid,
        extracted_place_id: existing.id,
        extracted_title: existing.data.title || parsed.name_hint || null,
        status: 'duplicate',
        duplicate_of: existing.id,
        resolved_at: new Date(),
        resolved_by: 'auto',
      });
      return res.status(200).json({
        outcome: 'duplicate',
        place_id: existing.id,
        title: existing.data.title || parsed.name_hint,
        breadcrumb: breadcrumbFor(existing.data),
        submission_id: submissionId,
      });
    }

    // 3. Scrape full place data. We need anchor coordinates near the
    // target — use the URL's coords directly (zoom 17, tight).
    if (typeof parsed.lat !== 'number' || typeof parsed.lon !== 'number') {
      const submissionId = await recordSubmission(db, {
        submitted_url: url,
        submitted_by_uid: uid,
        status: 'pending',
        admin_note: 'No coordinates in URL; needs manual lookup.',
        resolved_at: null,
        resolved_by: null,
      });
      return res.status(200).json({
        outcome: 'pending',
        reason:
          'Couldn\'t pinpoint the place from that link. Our team will review and add it.',
        submission_id: submissionId,
      });
    }
    let scrape;
    let scrapeError;
    try {
      // Scrape against the place's coordinates. The name_hint (or a
      // generic query) anchors the search; the lat/lon constrains it.
      const ll = `@${parsed.lat},${parsed.lon},17z`;
      const q = parsed.name_hint || 'place';
      log(req, 'scrape start', { q, ll });
      scrape = await scrapePlaceDetails({
        place_id: parsed.place_hex_pair || undefined,
        q,
        ll,
      }).catch(async (e) => {
        scrapeError = e;
        return null;
      });
    } catch (e) {
      scrapeError = e;
      scrape = null;
    }
    log(req, 'scrape done', {
      got_place_id: !!(scrape && scrape.place_id),
      title: scrape?.title,
      error: scrapeError?.message,
    });
    if (!scrape || !scrape.place_id) {
      const submissionId = await recordSubmission(db, {
        submitted_url: url,
        submitted_by_uid: uid,
        status: 'pending',
        admin_note: 'Scrape returned no result; needs manual lookup.',
        resolved_at: null,
        resolved_by: null,
      });
      return res.status(200).json({
        outcome: 'pending',
        reason: 'We couldn\'t auto-fetch details for that place. Our team will review.',
        submission_id: submissionId,
      });
    }

    // 4. Trust filter — must be inside Port Said + meet quality bar.
    const accepted = isAccepted(scrape);
    log(req, 'isAccepted', {
      accepted,
      lat: scrape.gps_coordinates?.latitude,
      lon: scrape.gps_coordinates?.longitude,
    });
    if (!accepted) {
      const submissionId = await recordSubmission(db, {
        submitted_url: url,
        submitted_by_uid: uid,
        extracted_place_id: scrape.place_id,
        extracted_title: scrape.title || parsed.name_hint || null,
        status: 'rejected',
        admin_note: 'Outside Port Said bounding box or missing core data.',
        resolved_at: new Date(),
        resolved_by: 'auto',
      });
      return res.status(200).json({
        outcome: 'rejected',
        reason:
          'PortSaid Guide only covers Port Said + Port Fouad. That place is outside the city.',
        submission_id: submissionId,
      });
    }

    // 5. Classify with the strict pipeline.
    log(req, 'classify start');
    const cls = await classify(scrape, null);
    const confidence = cls?.classification?.confidence ?? 0;
    const primary = cls?.primary_slug ?? 'other';
    const autoAddOk =
        confidence >= AUTO_ADD_CONFIDENCE && primary !== 'other';
    log(req, 'classify done', {
      primary,
      confidence,
      method: cls?.classification?.method,
      autoAddOk,
    });

    if (!autoAddOk) {
      const submissionId = await recordSubmission(db, {
        submitted_url: url,
        submitted_by_uid: uid,
        extracted_place_id: scrape.place_id,
        extracted_title: scrape.title || parsed.name_hint || null,
        status: 'pending',
        ai_verdict: {
          confidence,
          primary_slug: primary,
          source_categories: cls.source_categories,
          reasoning: cls.classification?.reasoning || '',
        },
        resolved_at: null,
        resolved_by: null,
      });
      return res.status(200).json({
        outcome: 'pending',
        reason: 'Our AI isn\'t confident enough about the category. Our team will review and add it shortly.',
        submission_id: submissionId,
      });
    }

    // 6. Auto-add. Build the merged place doc + write to places/.
    const now = new Date().toISOString();
    const { merged } = mergePlace(null, scrape, {
      now,
      scrapeRunId: 'user-submission',
      category: primary,
      anchorId: 'user-submission',
    });
    merged.primary_slug = cls.primary_slug;
    merged.source_categories = cls.source_categories;
    merged.attributes = cls.attributes;
    merged.classification = cls.classification;
    merged.created_by_uid = uid;
    merged.created_via = 'user_submission';

    await db.collection('places').doc(scrape.place_id).set(merged, { merge: true });

    const submissionId = await recordSubmission(db, {
      submitted_url: url,
      submitted_by_uid: uid,
      extracted_place_id: scrape.place_id,
      extracted_title: scrape.title,
      status: 'approved',
      ai_verdict: {
        confidence,
        primary_slug: primary,
        source_categories: cls.source_categories,
      },
      resolved_at: new Date(),
      resolved_by: 'auto',
    });
    // Back-ref so the place doc can be traced to a submission.
    await db.collection('places').doc(scrape.place_id).update({
      submission_id: submissionId,
    });

    return res.status(200).json({
      outcome: 'added',
      place_id: scrape.place_id,
      title: scrape.title,
      breadcrumb: breadcrumbFor(merged),
      submission_id: submissionId,
    });
}
