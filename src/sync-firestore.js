// CLI: push the entire local store to Firestore, then refresh derived
// indexes (meta/place_types).
//
// Usage:
//   FIRESTORE_PROJECT=port-said-guide \
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
//   node src/sync-firestore.js
//
// Flags:
//   --snapshots          also write per-place rating/review snapshots
//   --skip-index         skip the meta/place_types refresh (debug only)

import { parseArgs } from './util/args.js';
import { buildCatalogue } from './catalogue/bucket.js';
import {
  syncStoreToFirestore,
  writeCatalogue,
  writePlaceTypesIndex,
} from './pipeline/firestore.js';

const args = parseArgs(process.argv);
const storePath = args.store || new URL('../data/places.json', import.meta.url).pathname;

console.log(`◆ syncing ${storePath} → Firestore (${process.env.FIRESTORE_PROJECT})`);

try {
  // syncStoreToFirestore now returns the in-memory places array as well
  // as the uploaded count. Threading that array through the rest of the
  // sync avoids two redundant `listAllPlaces()` round-trips (~3,600
  // Firestore reads each) that were exhausting the free tier's 50k/day
  // read quota and producing `8 RESOURCE_EXHAUSTED: Quota exceeded.`
  // mid-run.
  const { uploaded, places } = await syncStoreToFirestore(storePath, {
    snapshotHistory: !!args.snapshots,
  });
  console.log(`✓ ${uploaded} places synced to Firestore`);

  // Refresh the derived `meta/place_types` index. We pass the local
  // places array via `from:` so writePlaceTypesIndex doesn't re-fetch
  // from Firestore — its `from ?? listAllPlaces()` fallback would
  // otherwise eat 3,600+ reads on every sync.
  if (!args['skip-index']) {
    console.log('◆ refreshing meta/place_types index');
    const idx = await writePlaceTypesIndex({ from: places });
    console.log(
      `✓ meta/place_types updated — ${idx.type_count} distinct types across ${idx.total_places} places`
    );
  }

  // Build + write the bucketed catalogue (`catalogue_buckets/*` +
  // `catalogue_meta/index`). Mobile's home / category / list views
  // read from this; the heavy `places/*` collection becomes a
  // detail-page-only concern. Same flag gates this as the
  // place_types refresh so a debug `--skip-index` run skips both.
  // Uses the same in-memory `places` array — no fresh Firestore reads.
  if (!args['skip-index']) {
    console.log('◆ refreshing catalogue (buckets + meta/index)');
    const catalogue = buildCatalogue(places);
    const result = await writeCatalogue(catalogue);
    console.log(
      `✓ catalogue updated — ${result.bucket_count} buckets across ` +
        `${result.main_count} mains, ${result.total_places} places`
    );
  }
} catch (e) {
  console.error('✗ sync failed:', e.message);
  process.exit(2);
}
