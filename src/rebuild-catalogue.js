// One-shot: re-derive meta/place_types + catalogue_buckets/* +
// catalogue_meta/index from the current state of the `places/`
// collection in Firestore. Doesn't re-classify or modify any place
// document — just rebuilds the derived indexes.
//
// Usage:
//   FIRESTORE_PROJECT=port-said-guide \
//   GOOGLE_APPLICATION_CREDENTIALS=secrets/firebase-service-account.json \
//   node src/rebuild-catalogue.js
//
// When to run:
//   - After tweaking ATTRIBUTE_SURFACING or any other catalogue-shaping
//     code without changing the underlying place data.
//   - After a recategorize --apply finished but the catalogue rebuild
//     phase crashed (rare but possible — quota error, network blip).
//   - As a manual nudge after editing source_categories directly in
//     Firestore.
//
// Cost: one `listAllPlaces()` read (~3,600 reads) + ~70 writes
// (catalogue_buckets/* + catalogue_meta/index + meta/place_types) +
// ~70 deletes (cleared catalogue_buckets/*). Well under the free
// tier's 50k/20k/20k daily limits for any reasonable use.

import { buildCatalogue } from './catalogue/bucket.js';
import {
  listAllPlaces,
  writeCatalogue,
  writePlaceTypesIndex,
} from './pipeline/firestore.js';

const projectId = process.env.FIRESTORE_PROJECT;
if (!projectId) {
  console.error('✗ Set FIRESTORE_PROJECT env var (e.g. port-said-guide).');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('✗ Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.');
  process.exit(1);
}

const t0 = Date.now();
console.log(`◆ rebuilding catalogue + place_types index for ${projectId}`);

try {
  // One read pass over the whole `places/` collection. We pass the
  // result to BOTH downstream writers so we don't double-fetch.
  console.log('  reading places from Firestore...');
  const places = await listAllPlaces();
  console.log(`  ${places.length} places loaded`);

  console.log('◆ refreshing meta/place_types index');
  const idx = await writePlaceTypesIndex({ from: places });
  console.log(
    `✓ meta/place_types updated — ${idx.type_count} distinct types across ${idx.total_places} places`
  );

  console.log('◆ rebuilding catalogue (buckets + meta/index)');
  const catalogue = buildCatalogue(places);
  const result = await writeCatalogue(catalogue);
  console.log(
    `✓ catalogue updated — ${result.bucket_count} buckets across ` +
      `${result.main_count} mains, ${result.total_places} places`
  );

  console.log(`\n◆ done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.error('✗ rebuild failed:', e.message);
  process.exit(2);
}
