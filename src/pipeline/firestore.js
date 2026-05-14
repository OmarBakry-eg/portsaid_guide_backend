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

/// Read every place document from Firestore as a plain array. Used by
/// the public API endpoints (`/place-types`, eventually `/places` /
/// `/categories`) so they have a real source of truth in production
/// where the on-disk `places.json` is ephemeral. Returns an array of
/// place objects in whatever order Firestore enumerates them; callers
/// sort / aggregate as needed.
///
/// Cheap to call — Firestore charges ~1 read per document. The web
/// server caches the result locally (see `/place-types` impl) so this
/// only fires once per cache window per process.
export async function listAllPlaces() {
  const db = await getFirestore();
  const snap = await db.collection('places').get();
  return snap.docs.map((d) => d.data());
}

/// Bucketed catalogue write — fan-out of the canonical "browse view".
///
/// Persistence layout:
///   - `catalogue_buckets/{main}__{sub}` — one doc per (main, sub)
///     containing the compact place list + metadata. Typical doc is
///     25–150 KB; the largest theoretical bucket (Shopping >
///     supermarket) is well under Firestore's 1 MiB limit.
///   - `catalogue_meta/index` — small summary doc with counts +
///     labels per main+sub. Mobile reads this for the home grid; the
///     bucket docs are streamed for the actual browse surfaces.
///
/// We write the buckets in batches of up to 400 docs each (Firestore
/// commit limit is 500; 400 leaves headroom for the meta write).
/// Every existing `catalogue_buckets/*` doc is deleted first so stale
/// buckets from a previous run don't leak in — e.g. if Other's top-20
/// types shift between runs, the old `type_*` docs would otherwise
/// linger forever.
export async function writeCatalogue(catalogue) {
  const db = await getFirestore();

  // Build the docs to write. Bucket doc IDs use double-underscore to
  // join main + sub, e.g. `food__coffee`, `other__type_beauty_salon`.
  const bucketDocs = [];
  for (const [mainSlug, main] of Object.entries(catalogue.mains)) {
    for (const [subSlug, sub] of Object.entries(main.subs)) {
      bucketDocs.push({
        id: `${mainSlug}__${subSlug}`,
        data: {
          main: mainSlug,
          sub: subSlug,
          label: sub.label,
          raw_type: sub.raw_type ?? null,
          place_count: sub.place_count,
          places: sub.places,
          generated_at: catalogue.generated_at,
        },
      });
    }
  }

  // Wipe-then-write rather than diff-merge. Catalogue is small (~65
  // docs), regenerated entirely per cron run, and the cost of a stale
  // bucket lingering is real (the user sees ghost categories). A full
  // overwrite is the simpler, safer contract.
  const existing = await db.collection('catalogue_buckets').get();
  const COMMIT_LIMIT = 400;

  // Delete old docs in batches.
  for (let i = 0; i < existing.docs.length; i += COMMIT_LIMIT) {
    const batch = db.batch();
    const slice = existing.docs.slice(i, i + COMMIT_LIMIT);
    for (const doc of slice) batch.delete(doc.ref);
    await batch.commit();
  }

  // Write new bucket docs.
  for (let i = 0; i < bucketDocs.length; i += COMMIT_LIMIT) {
    const batch = db.batch();
    const slice = bucketDocs.slice(i, i + COMMIT_LIMIT);
    for (const { id, data } of slice) {
      batch.set(db.collection('catalogue_buckets').doc(id), data);
    }
    await batch.commit();
  }

  // Write the summary index doc last so any reader that races the
  // build sees a self-consistent view: either the OLD index pointing
  // to the OLD buckets (we cleared them; mobile gets empty until the
  // index updates) or the NEW index pointing to the NEW buckets.
  const indexDoc = (await import('../catalogue/bucket.js')).buildCatalogueIndex(
      catalogue);
  await db.collection('catalogue_meta').doc('index').set(indexDoc);

  return {
    bucket_count: bucketDocs.length,
    total_places: catalogue.total_places,
    main_count: Object.keys(catalogue.mains).length,
  };
}

/// Read the `catalogue_meta/index` summary doc back. Returns null if
/// the catalogue hasn't been bootstrapped yet. Cheap (1 Firestore
/// read), used by the HTTP test endpoint and any caller that just
/// wants the structure without the full place lists.
export async function readCatalogueIndex() {
  const db = await getFirestore();
  const snap = await db.collection('catalogue_meta').doc('index').get();
  return snap.exists ? snap.data() : null;
}

/// Read every bucket doc back as an array. Used by the HTTP test
/// endpoint to assemble a full tree response — the mobile app reads
/// these via a Firestore snapshots() stream and groups client-side,
/// so this isn't on the mobile's read path.
export async function readCatalogueBuckets() {
  const db = await getFirestore();
  const snap = await db.collection('catalogue_buckets').get();
  return snap.docs.map((d) => d.data());
}

/// Read the pre-computed `meta/place_types` snapshot doc. Returns the
/// stored payload (or null if it doesn't exist yet — pre-bootstrap).
/// One Firestore read regardless of catalogue size; the doc is the
/// canonical source the mobile app subscribes to.
export async function readPlaceTypesIndex() {
  const db = await getFirestore();
  const snap = await db.collection('meta').doc('place_types').get();
  return snap.exists ? snap.data() : null;
}

/// Compute the place-types index from every Firestore place doc and
/// write it as a single document at `meta/place_types`. Called at the
/// end of every successful cron sync so the mobile app can subscribe
/// to `meta/place_types` directly — no Render server hop, no cold-
/// start latency, real-time updates the next time the cron writes.
///
/// Doc shape:
///   meta/place_types {
///     generated_at: ISO timestamp string
///     total_places: int
///     type_count:   int
///     types:        Array<{ type, count, is_arabic, examples[<=3] }>
///   }
///
/// We deliberately keep `examples` to 3 per type to stay well under
/// Firestore's 1 MiB doc limit even if the catalogue grows to 10k+
/// distinct types.
export async function writePlaceTypesIndex({ from } = {}) {
  const places = from ?? (await listAllPlaces());

  const isArabic = (s) => /[؀-ۿ]/.test(s);
  const perType = new Map(); // type → { count, examples }

  for (const p of places) {
    if (!p) continue;
    // Collect every distinct type label this place exposes (primary
    // `type` + secondary entries in `types[]`).
    const variants = new Set();
    if (typeof p.type === 'string' && p.type.trim()) variants.add(p.type.trim());
    if (Array.isArray(p.types)) {
      for (const t of p.types) {
        if (typeof t === 'string' && t.trim()) variants.add(t.trim());
      }
    }
    for (const t of variants) {
      let bucket = perType.get(t);
      if (!bucket) {
        bucket = { count: 0, examples: [] };
        perType.set(t, bucket);
      }
      bucket.count += 1;
      if (bucket.examples.length < 3 && typeof p.title === 'string' && p.title) {
        bucket.examples.push(p.title);
      }
    }
  }

  const types = [...perType.entries()]
    .map(([type, bucket]) => ({
      type,
      count: bucket.count,
      is_arabic: isArabic(type),
      examples: bucket.examples,
    }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  const doc = {
    generated_at: new Date().toISOString(),
    total_places: places.length,
    type_count: types.length,
    types,
  };

  const db = await getFirestore();
  await db.collection('meta').doc('place_types').set(doc);
  return doc;
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
