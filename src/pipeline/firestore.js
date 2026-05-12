// Firestore exporter. Pushes the local places.json store to Firestore so the
// Flutter app can subscribe to real-time updates without ever touching our
// HTTP server for list/detail reads.
//
// SETUP (one-time):
//   1. Firebase Console → Project Settings → Service accounts →
//      "Generate new private key" → save JSON locally.
//   2. Export env vars (or put them in scraper/.env):
//        export FIRESTORE_PROJECT=port-said-guide
//        export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json
//   3. `npm install firebase-admin`
//   4. `npm run sync-firestore`
//
// SCHEMA in Firestore:
//   places/{place_id}                     full place document (the one in places.json)
//   places/{place_id}/reviews/{n}         (optional) per-review docs if you want
//                                         separate queries; for now we store as
//                                         array on the parent.
//   meta/runs/{run_id}                    scrape-run telemetry
//
// The Flutter app subscribes to `places` with a where('source_categories',
// arrayContains: 'restaurant').orderBy('rating', desc).snapshots() stream.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

let _db = null;

async function getFirestore() {
  if (_db) return _db;
  const projectId = process.env.FIRESTORE_PROJECT;
  if (!projectId) throw new Error('Set FIRESTORE_PROJECT env var (e.g. port-said-guide)');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'Set GOOGLE_APPLICATION_CREDENTIALS env var to the path of your service account JSON'
    );
  }
  if (!existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    throw new Error(
      `Service account file not found: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`
    );
  }

  // Lazy import so non-Firestore commands don't need firebase-admin installed.
  const admin = await import('firebase-admin').catch(() => {
    throw new Error('Run `npm install firebase-admin` first');
  });
  if (!admin.default.apps.length) {
    admin.default.initializeApp({
      credential: admin.default.credential.applicationDefault(),
      projectId,
    });
  }
  _db = admin.default.firestore();
  // Brand-new places may have no rating / weighted_rating yet. Treat
  // `undefined` field values as "field absent" instead of throwing.
  _db.settings({ ignoreUndefinedProperties: true });
  return _db;
}

// Sanitise a place document for Firestore: drop undefined values (Firestore
// rejects them), cap array sizes (Firestore has a 1MiB doc limit), and ensure
// nested values are JSON-compatible.
function sanitizeForFirestore(place) {
  // Keep reviews_data ≤ 8 and photos_data ≤ 50 (already the case but defensive).
  const out = { ...place };
  if (Array.isArray(out.reviews_data)) out.reviews_data = out.reviews_data.slice(0, 8);
  if (Array.isArray(out.photos_data)) out.photos_data = out.photos_data.slice(0, 50);
  if (Array.isArray(out.extensions)) out.extensions = out.extensions.slice(0, 20);
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

// Upload one place to Firestore. Used by both the bulk sync and the
// per-place on-demand refresh from the server.
export async function uploadOnePlace(place) {
  if (!place?.place_id) throw new Error('place.place_id required');
  const db = await getFirestore();
  await db
    .collection('places')
    .doc(place.place_id)
    .set(sanitizeForFirestore(place), { merge: true });
  return { uploaded: 1 };
}

// Bulk sync: push every place from places.json. Uses batched writes (500/batch
// is Firestore's max). Optionally writes snapshot history.
export async function syncStoreToFirestore(storePath, { snapshotHistory = false } = {}) {
  const store = JSON.parse(await readFile(storePath, 'utf8'));
  const places = Object.values(store.places ?? {});
  if (!places.length) {
    console.log('No places in store. Nothing to sync.');
    return { uploaded: 0 };
  }

  const db = await getFirestore();
  const BATCH = 500;
  let uploaded = 0;
  const t0 = Date.now();

  for (let i = 0; i < places.length; i += BATCH) {
    const batch = db.batch();
    const chunk = places.slice(i, i + BATCH);
    for (const place of chunk) {
      if (!place.place_id) continue;
      const ref = db.collection('places').doc(place.place_id);
      batch.set(ref, sanitizeForFirestore(place), { merge: true });

      if (snapshotHistory && (place.rating != null || place.reviews != null)) {
        // Time-series: lightweight rating/reviews point per scrape run.
        const ts = (place.last_scraped_at ?? new Date().toISOString()).replace(/[:.]/g, '-');
        const snapRef = ref.collection('snapshots').doc(ts);
        batch.set(snapRef, {
          at: place.last_scraped_at,
          rating: place.rating ?? null,
          reviews: place.reviews ?? null,
          open_state: place.open_state ?? null,
          run_id: place.last_scrape_run_id ?? null,
        });
      }
    }
    await batch.commit();
    uploaded += chunk.length;
    process.stdout.write(
      `\r  ${uploaded}/${places.length}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`
    );
  }
  process.stdout.write('\n');
  return { uploaded };
}
