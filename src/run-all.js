import { parseArgs } from './util/args.js';
import { runOrchestrator } from './pipeline/orchestrator.js';

const args = parseArgs(process.argv);

if (args.help) {
  console.log(`Usage: node src/run-all.js [options]

  --force                  Run every (category × anchor), ignoring cadence
  --only=slug1,slug2       Run only these category slugs (e.g. coffee,restaurant)
  --anchors=id1,id2        Run only these anchor ids (e.g. city-center,port-fouad)
  --max=N                  Limit number of jobs this run (useful for testing)
  --delay=N                Seconds between jobs (default: 30)
  --store=path.json        Override store path
`);
  process.exit(0);
}

const only = typeof args.only === 'string' ? args.only.split(',').map((s) => s.trim()) : null;
const onlyAnchors =
  typeof args.anchors === 'string' ? args.anchors.split(',').map((s) => s.trim()) : null;

try {
  await runOrchestrator({
    force: !!args.force,
    only,
    onlyAnchors,
    maxJobs: args.max ? parseInt(args.max, 10) : Infinity,
    delayBetweenJobsMs: args.delay ? parseInt(args.delay, 10) * 1000 : 30_000,
    storePath: args.store || undefined,
  });
} catch (e) {
  console.error('✗ orchestrator failed:', e.message);
  process.exit(2);
}
