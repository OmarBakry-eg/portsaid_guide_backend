import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { scrape } from '../scrape.js';
import { loadStore, saveStore, applyScrape } from './normalize.js';

const CONFIG_DIR = new URL('../../config/', import.meta.url).pathname;
const DATA_DIR = new URL('../../data/', import.meta.url).pathname;

async function readConfig(name) {
  return JSON.parse(await readFile(`${CONFIG_DIR}${name}.json`, 'utf8'));
}

// Build the job list, filtered by cadence: a job runs only if its last
// successful run was longer ago than its category's `cadence_hours`.
async function buildJobList({ runLog, anchors, categories, force = false, only = null, onlyAnchors = null }) {
  const now = Date.now();
  const jobs = [];
  for (const cat of categories) {
    if (only && !only.includes(cat.slug)) continue;
    for (const anchor of anchors) {
      if (onlyAnchors && !onlyAnchors.includes(anchor.id)) continue;
      // Include the query in the key so the same slug can have multilingual
      // variants (e.g. hospital@city-center+en, hospital@city-center+ar).
      const key = `${cat.slug}@${anchor.id}+${cat.hl || 'en'}:${cat.q}`;
      const lastRunAt = runLog.last[key]?.finished_at;
      const dueAt = lastRunAt
        ? new Date(lastRunAt).getTime() + cat.cadence_hours * 3600 * 1000
        : 0;
      if (!force && now < dueAt) continue;
      jobs.push({ key, category: cat, anchor });
    }
  }
  return jobs;
}

async function loadRunLog(path) {
  if (!existsSync(path)) return { last: {}, history: [] };
  return JSON.parse(await readFile(path, 'utf8'));
}

async function saveRunLog(path, log) {
  await mkdir(dirname(path), { recursive: true });
  // Cap history to the last 500 runs so the log file stays small.
  log.history = log.history.slice(-500);
  await writeFile(path, JSON.stringify(log, null, 2));
}

function fmtElapsed(ms) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export async function runOrchestrator({
  force = false,
  only = null,
  onlyAnchors = null,
  delayBetweenJobsMs = 30_000,
  maxJobs = Infinity,
  storePath = `${DATA_DIR}places.json`,
  runLogPath = `${DATA_DIR}run-log.json`,
} = {}) {
  const [{ anchors }, { categories }] = await Promise.all([
    readConfig('anchors'),
    readConfig('categories'),
  ]);

  const runLog = await loadRunLog(runLogPath);
  const store = await loadStore(storePath);

  const jobs = await buildJobList({ runLog, anchors, categories, force, only, onlyAnchors });
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  console.log(`◆ ${runId}`);
  console.log(`  ${jobs.length} jobs queued (anchors=${anchors.length}, categories=${categories.length}, force=${force})`);
  if (!jobs.length) {
    console.log('  Nothing due. Use --force to rerun everything.');
    return { runId, jobs: 0 };
  }

  const startedAt = Date.now();
  const runSummary = { runId, started_at: new Date().toISOString(), jobs: [] };

  let i = 0;
  for (const job of jobs.slice(0, maxJobs)) {
    i += 1;
    const jobStart = Date.now();
    process.stdout.write(`  [${i}/${jobs.length}] ${job.key.padEnd(36)} ... `);
    try {
      const result = await scrape({
        q: job.category.q,
        ll: job.anchor.ll,
        hl: job.category.hl || 'en',
      });
      const stats = applyScrape(store, result, {
        scrapeRunId: runId,
        category: job.category.slug,
        anchorId: job.anchor.id,
      });
      const elapsed = Date.now() - jobStart;
      runLog.last[job.key] = {
        finished_at: new Date().toISOString(),
        status: 'ok',
        stats,
      };
      runSummary.jobs.push({ key: job.key, status: 'ok', elapsed_ms: elapsed, ...stats });
      console.log(
        `${stats.found} found (+${stats.new} new, ~${stats.updated} updated, ${stats.rejected ?? 0} rejected)  ${fmtElapsed(elapsed)}`
      );
    } catch (e) {
      const elapsed = Date.now() - jobStart;
      runLog.last[job.key] = {
        finished_at: new Date().toISOString(),
        status: 'error',
        error: e.message,
      };
      runSummary.jobs.push({ key: job.key, status: 'error', error: e.message, elapsed_ms: elapsed });
      console.log(`✗ ${e.message}  ${fmtElapsed(elapsed)}`);
    }

    // Persist after every job so a mid-run failure doesn't lose work.
    await saveStore(storePath, store);
    await saveRunLog(runLogPath, runLog);

    // Throttle to stay polite + avoid rate limiting.
    if (i < jobs.length) await new Promise((r) => setTimeout(r, delayBetweenJobsMs));
  }

  runSummary.finished_at = new Date().toISOString();
  runSummary.elapsed_ms = Date.now() - startedAt;
  runLog.history.push(runSummary);
  await saveRunLog(runLogPath, runLog);

  // Final tally.
  const totals = runSummary.jobs.reduce(
    (a, j) => ({
      ok: a.ok + (j.status === 'ok' ? 1 : 0),
      err: a.err + (j.status === 'error' ? 1 : 0),
      new: a.new + (j.new || 0),
      upd: a.upd + (j.updated || 0),
    }),
    { ok: 0, err: 0, new: 0, upd: 0 }
  );
  console.log(
    `\n◆ done in ${fmtElapsed(runSummary.elapsed_ms)} — ` +
      `${totals.ok} ok, ${totals.err} err, +${totals.new} new places, ~${totals.upd} updated`
  );
  console.log(`  Store: ${storePath}  (${Object.keys(store.places).length} places total)`);
  return runSummary;
}
