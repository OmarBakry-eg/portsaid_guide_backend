// CLI: push the local store to Firestore, then refresh derived
// indexes (meta/place_types, catalogue_buckets).
//
// Usage:
//   FIRESTORE_PROJECT=port-said-guide \
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
//   node src/sync-firestore.js
//
// Flags:
//   --snapshots          also write per-place rating/review snapshots
//   --skip-index         skip the meta/place_types refresh (debug only)
//   --full               write EVERY place in the store, not just
//                        places touched this cron run. Default mode
//                        reads the latest run ID from data/run-log.json
//                        and only syncs places whose last_scrape_run_id
//                        matches — this preserves any independent
//                        Firestore state (e.g. backfill cleanups) for
//                        places the cron didn't see this run.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { parseArgs } from './util/args.js';
import { buildCatalogue } from './catalogue/bucket.js';
import {
  listAllPlaces,
  syncStoreToFirestore,
  writeCatalogue,
  writePlaceTypesIndex,
} from './pipeline/firestore.js';

const args = parseArgs(process.argv);
const storePath = args.store || new URL('../data/places.json', import.meta.url).pathname;
const runLogPath = new URL('../data/run-log.json', import.meta.url).pathname;

// Default = filter by latest cron run ID. --full bypasses the filter.
//
// Resolution order for the run ID we filter by:
//   1. `--run-id=<value>` CLI flag (explicit override; used by the
//      matrix GHA workflow where each matrix sibling writes to its
//      own filesystem and there's no shared run-log.json the merge
//      job can read).
//   2. RUN_ID env var (same purpose; the workflow also sets this).
//   3. data/run-log.json — the latest entry's runId, if recent
//      (within 24h). Used by the standard single-job cron + local
//      manual invocations.
//   4. null → fall back to FULL sync.
let touchedRunId = null;
if (!args.full) {
  if (typeof args['run-id'] === 'string' && args['run-id'].length > 0) {
    touchedRunId = args['run-id'];
  } else if (typeof process.env.RUN_ID === 'string' && process.env.RUN_ID.length > 0) {
    touchedRunId = process.env.RUN_ID;
  } else {
    touchedRunId = await readLatestRunId(runLogPath);
  }
  if (!touchedRunId) {
    console.log(
      '  no run ID provided / no recent run-log — falling back to FULL sync'
    );
  }
}

console.log(`◆ syncing ${storePath} → Firestore (${process.env.FIRESTORE_PROJECT})`);
if (touchedRunId) {
  console.log(`  delta mode: filtering to last_scrape_run_id = ${touchedRunId}`);
} else {
  console.log('  full mode: writing every place in the store');
}

try {
  // syncStoreToFirestore performs the delta write (only places touched
  // this cron run, filtered by touchedRunId). The returned `places`
  // array is the local in-memory store — useful when the catalogue
  // rebuild can trust the local cache, but the cache CAN drift from
  // Firestore when independent edits happen between cron runs (e.g. a
  // recategorize-firestore.js backfill that cleaned categorization in
  // Firestore but didn't update the GHA cache).
  //
  // To keep the catalogue and place_types index coherent with the
  // actual Firestore state — not with the GHA cache — we now read
  // back fresh from Firestore after the writes complete and feed
  // that into both downstream writers. One listAllPlaces() call is
  // shared across both index builds so we don't pay the read twice.
  //
  // Cost: ~3,500 reads per sync × 4 syncs/day = ~14k reads/day,
  // comfortably under the 50k/day free tier ceiling. The previous
  // "use local array" optimization saved this read but at the cost
  // of catalogue staleness whenever Firestore was touched outside
  // the cron flow.
  const { uploaded } = await syncStoreToFirestore(storePath, {
    snapshotHistory: !!args.snapshots,
    touchedRunId,
  });
  console.log(`✓ ${uploaded} places synced to Firestore`);

  if (!args['skip-index']) {
    console.log('◆ reading places from Firestore for index rebuild');
    const places = await listAllPlaces();
    console.log(`  ${places.length} places loaded from Firestore`);

    // Refresh the derived `meta/place_types` index using the fresh
    // Firestore snapshot, not the local cache.
    console.log('◆ refreshing meta/place_types index');
    const idx = await writePlaceTypesIndex({ from: places });
    console.log(
      `✓ meta/place_types updated — ${idx.type_count} distinct types across ${idx.total_places} places`
    );

    // Build + write the bucketed catalogue from the same fresh
    // snapshot. Wipes existing catalogue_buckets/* and rewrites
    // — guarantees the catalogue mirrors places/ exactly, so any
    // backfill / manual cleanup that touched Firestore between
    // cron runs survives the rebuild.
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

/// Look up the most recent orchestrator run ID from data/run-log.json.
/// Returns null when no log exists or the latest run is "too old" to
/// trust (heuristically: > 24h, in which case the cron presumably
/// failed and a full sync is the safer choice).
async function readLatestRunId(path) {
  if (!existsSync(path)) return null;
  try {
    const log = JSON.parse(await readFile(path, 'utf8'));
    const history = Array.isArray(log.history) ? log.history : [];
    if (!history.length) return null;
    const latest = history[history.length - 1];
    if (!latest?.runId) return null;
    // Sanity check: if the latest run finished more than 24h ago,
    // something's off — fall back to a full sync.
    if (latest.finished_at) {
      const ageMs = Date.now() - new Date(latest.finished_at).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) return null;
    }
    return latest.runId;
  } catch {
    return null;
  }
}
