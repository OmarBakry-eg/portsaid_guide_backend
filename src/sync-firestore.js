// CLI: push the entire local store to Firestore.
//
// Usage:
//   FIRESTORE_PROJECT=port-said-guide \
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
//   node src/sync-firestore.js

import { parseArgs } from './util/args.js';
import { syncStoreToFirestore } from './pipeline/firestore.js';

const args = parseArgs(process.argv);
const storePath = args.store || new URL('../data/places.json', import.meta.url).pathname;

console.log(`◆ syncing ${storePath} → Firestore (${process.env.FIRESTORE_PROJECT})`);

try {
  const { uploaded } = await syncStoreToFirestore(storePath, {
    snapshotHistory: !!args.snapshots,
  });
  console.log(`✓ ${uploaded} places synced to Firestore`);
} catch (e) {
  console.error('✗ sync failed:', e.message);
  process.exit(2);
}
