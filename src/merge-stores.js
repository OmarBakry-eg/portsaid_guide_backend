// Merge N per-anchor `places.json` files into a single consolidated
// store. Used by the GHA "merge-and-sync" job after the parallel
// matrix scrape produces 6 per-anchor artifacts.
//
// Usage:
//   node src/merge-stores.js --out=data/places.json \
//     artifacts/places-city-center/places.json \
//     artifacts/places-port-fouad/places.json \
//     ...
//
// Behavior:
//   - For each place_id seen across the inputs, mergePlace() combines
//     the records — preserving best position rank, longest reviews/
//     photos arrays, unioned source_categories and source_anchors,
//     the most recent rating/reviews counts, etc.
//   - Places only seen in one input pass through unchanged.
//   - Places in zero inputs (because every matrix job ignored them
//     this run) keep their previous state from whichever input
//     first surfaced them — the matrix jobs each restored the same
//     base cache before scraping, so untouched places are identical
//     across all inputs.
//
// Output preserves the standard {places: {place_id: <record>}}
// shape that loadStore/saveStore use.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { mergePlace } from './pipeline/normalize.js';
import { parseArgs } from './util/args.js';

const args = parseArgs(process.argv);
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const inputs = positional;
const outPath = args.out || 'data/places.json';

if (args.help || inputs.length === 0) {
  console.log(`Usage: node src/merge-stores.js --out=path/to/merged.json input1.json [input2.json ...]

Merges multiple per-anchor place stores into a single consolidated store.
Each input must be a JSON file matching the { places: {...} } shape.
`);
  process.exit(args.help ? 0 : 1);
}

const t0 = Date.now();
console.log(`◆ merging ${inputs.length} store(s) → ${outPath}`);

const merged = { places: {} };
let totalConsidered = 0;
let totalKept = 0;

for (const path of inputs) {
  if (!existsSync(path)) {
    console.log(`  skip ${path} (missing)`);
    continue;
  }
  let store;
  try {
    store = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    console.error(`  ✗ failed to parse ${path}: ${e.message}`);
    continue;
  }
  const places = Object.values(store.places ?? {});
  let mergedFromThis = 0;
  for (const incoming of places) {
    if (!incoming?.place_id) continue;
    totalConsidered += 1;
    const prev = merged.places[incoming.place_id];

    if (!prev) {
      // First time we see this place — drop in as-is. No mergePlace
      // call needed because there's no prior signal to combine.
      merged.places[incoming.place_id] = incoming;
      totalKept += 1;
      mergedFromThis += 1;
      continue;
    }

    // Multiple inputs agree on this place — combine their signals.
    // mergePlace expects (prev, fresh, meta); we feed the meta from
    // the incoming record itself so the merged output reflects the
    // most recent scrape's anchor + run ID.
    const { merged: combined } = mergePlace(prev, incoming, {
      now: incoming.last_seen_at || new Date().toISOString(),
      scrapeRunId: incoming.last_scrape_run_id || prev.last_scrape_run_id,
      category: incoming.source_categories?.[0] || prev.source_categories?.[0] || 'other',
      anchorId: incoming.source_anchors?.[0] || prev.source_anchors?.[0] || 'unknown',
    });
    merged.places[incoming.place_id] = combined;
    mergedFromThis += 1;
  }
  console.log(`  + ${path}: ${places.length} places (${mergedFromThis} processed)`);
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(merged, null, 2));

const uniqueOut = Object.keys(merged.places).length;
console.log(`\n✓ merged ${totalConsidered} place-records across inputs → ${uniqueOut} unique places`);
console.log(`  output: ${outPath}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
