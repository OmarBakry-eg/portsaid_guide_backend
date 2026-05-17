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
  syncStoreToFirestore,
  writeCatalogue,
  writePlaceTypesIndex,
} from './pipeline/firestore.js';

const args = parseArgs(process.argv);
const storePath = args.store || new URL('../data/places.json', import.meta.url).pathname;
const runLogPath = new URL('../data/run-log.json', import.meta.url).pathname;

// Default = filter by latest cron run ID. --full bypasses the filter.
let touchedRunId = null;
if (!args.full) {
  touchedRunId = await readLatestRunId(runLogPath);
  if (!touchedRunId) {
    console.log(
      '  no run-log found / no recent run — falling back to FULL sync'
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
  // syncStoreToFirestore now returns the in-memory places array as well
  // as the uploaded count. Threading that array through the rest of the
  // sync avoids two redundant `listAllPlaces()` round-trips (~3,600
  // Firestore reads each) that were exhausting the free tier's 50k/day
  // read quota and producing `8 RESOURCE_EXHAUSTED: Quota exceeded.`
  // mid-run.
  //
  // When touchedRunId is set, only places with last_scrape_run_id
  // matching get WRITTEN to Firestore — but the returned `places`
  // array is the FULL store, used downstream for the catalogue
  // rebuild so the catalogue reflects total state, not just deltas.
  const { uploaded, places } = await syncStoreToFirestore(storePath, {
    snapshotHistory: !!args.snapshots,
    touchedRunId,
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
