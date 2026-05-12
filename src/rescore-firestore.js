// One-shot: walk every place doc in Firestore, recompute weighted_rating /
// quality_score / sort_score using the latest formulas, and either UPDATE
// (if it still passes the trust filter) or DELETE (if it doesn't).
//
// Use this after changing scoring weights or thresholds, OR when introducing
// the scoring fields to a corpus that was scraped before they existed.
//
// Idempotent — running it twice produces no further changes.
//
//   FIRESTORE_PROJECT=port-said-guide \
//   GOOGLE_APPLICATION_CREDENTIALS=secrets/firebase-service-account.json \
//   node src/rescore-firestore.js
//
// Flags:
//   --dry-run          only print what would change, don't write
//   --keep-rejected    update scores but don't delete failing docs

import { enrichWithScores, isAccepted, QUALITY_THRESHOLD } from './parsers/scoring.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keepRejected = args.includes('--keep-rejected');

const projectId = process.env.FIRESTORE_PROJECT;
if (!projectId) {
  console.error('✗ Set FIRESTORE_PROJECT env var (e.g. port-said-guide).');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    '✗ Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service-account JSON.'
  );
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
// Some places legitimately have no rating yet (brand new, zero reviews).
// Treat undefined as "field absent" instead of erroring on write.
db.settings({ ignoreUndefinedProperties: true });

console.log(
  `◆ rescoring places in project ${projectId} ` +
    `(threshold = ${QUALITY_THRESHOLD}${dryRun ? ', dry-run' : ''}${
      keepRejected ? ', keep-rejected' : ''
    })`
);

const t0 = Date.now();
const snap = await db.collection('places').get();
console.log(`  ${snap.size} docs read`);

let updated = 0;
let unchanged = 0;
let deleted = 0;
let rejected = 0;
let batch = db.batch();
let inBatch = 0;
const BATCH_LIMIT = 400;

async function flush() {
  if (inBatch === 0) return;
  if (!dryRun) await batch.commit();
  batch = db.batch();
  inBatch = 0;
}

for (const doc of snap.docs) {
  const data = doc.data();
  const oldScores = {
    weighted: data.weighted_rating,
    quality: data.quality_score,
    sort: data.sort_score,
  };

  enrichWithScores(data);

  const accepted = isAccepted(data);

  if (!accepted) {
    rejected += 1;
    if (keepRejected) {
      // Update scores but leave the doc in place.
      batch.set(doc.ref, data, { merge: false });
      inBatch += 1;
    } else {
      batch.delete(doc.ref);
      inBatch += 1;
      deleted += 1;
    }
  } else if (
    oldScores.weighted !== data.weighted_rating ||
    oldScores.quality !== data.quality_score ||
    oldScores.sort !== data.sort_score
  ) {
    batch.set(doc.ref, data, { merge: false });
    inBatch += 1;
    updated += 1;
  } else {
    unchanged += 1;
  }

  if (inBatch >= BATCH_LIMIT) {
    await flush();
    process.stdout.write(
      `\r  scanned ${updated + unchanged + deleted}/${snap.size}  ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)`
    );
  }
}
await flush();
process.stdout.write('\n');

console.log(
  `✓ done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
    `${updated} rescored, ${deleted} deleted (junk), ${unchanged} unchanged. ` +
    `${rejected} docs failed the quality filter total.` +
    (dryRun ? '  (dry-run — no writes applied)' : '')
);
