// One-shot maintenance script: walk every document in the `places` collection
// on Firestore and strip any `http(s)://*/img?u=ENCODED` proxy wrappers so we
// store the raw Google CDN URL instead.
//
// Why: stored proxy URLs reference a specific host:port (e.g. localhost:8080)
// that doesn't exist on user devices. Raw `lh3.googleusercontent.com` URLs
// load directly from Google's CDN and work everywhere.
//
// Run once after deploying the raw-URL change:
//
//   FIRESTORE_PROJECT=port-said-guide \
//   GOOGLE_APPLICATION_CREDENTIALS=secrets/firebase-service-account.json \
//   node src/scrub-firestore.js
//
// Idempotent — running it again on already-clean docs is a no-op.

import { stripProxyUrls } from './config.js';

const projectId = process.env.FIRESTORE_PROJECT;
if (!projectId) {
  console.error('✗ Set FIRESTORE_PROJECT env var (e.g. port-said-guide).');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('✗ Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON.');
  process.exit(1);
}

const admin = await import('firebase-admin');
if (!admin.default.apps.length) {
  admin.default.initializeApp({
    credential: admin.default.credential.applicationDefault(),
    projectId,
  });
}
const db = admin.default.firestore();

const PROXY_URL_REGEX = /https?:\/\/[^"'\s/]+\/img\?u=/;

function docNeedsScrub(data) {
  // Cheap pre-check: stringify and grep — saves iterating individual fields
  // if no proxy URLs are present.
  try {
    return PROXY_URL_REGEX.test(JSON.stringify(data));
  } catch (_) {
    return true; // can't tell — scrub to be safe
  }
}

const t0 = Date.now();
console.log(`◆ scrubbing proxy URLs from places collection on project ${projectId}`);

const snap = await db.collection('places').get();
console.log(`  ${snap.size} docs read`);

let scanned = 0;
let touched = 0;
let batch = db.batch();
let inBatch = 0;
const BATCH_LIMIT = 400;

async function flushBatch() {
  if (inBatch === 0) return;
  await batch.commit();
  batch = db.batch();
  inBatch = 0;
}

for (const doc of snap.docs) {
  scanned += 1;
  const data = doc.data();
  if (!docNeedsScrub(data)) continue;
  const cleaned = stripProxyUrls(data);
  batch.set(doc.ref, cleaned, { merge: false });
  inBatch += 1;
  touched += 1;
  if (inBatch >= BATCH_LIMIT) {
    await flushBatch();
    process.stdout.write(
      `\r  scrubbed ${touched}/${scanned}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`
    );
  }
}
await flushBatch();
process.stdout.write('\n');

console.log(
  `✓ done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
    `${touched} of ${scanned} docs updated to raw Google CDN URLs.`
);
