import { parseArgs } from './util/args.js';
import { uploadPlaces } from './pipeline/firestore.js';

const args = parseArgs(process.argv);
const storePath = args.store || 'data/places.json';
const snapshotHistory = !!args.snapshots;

console.log(`◆ uploading ${storePath} → Firestore project=${process.env.FIRESTORE_PROJECT}`);
try {
  const { uploaded } = await uploadPlaces(storePath, { snapshotHistory });
  console.log(`✓ ${uploaded} places uploaded`);
} catch (e) {
  console.error('✗ upload failed:', e.message);
  process.exit(2);
}
