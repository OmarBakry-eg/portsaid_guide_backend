import { parseArgs } from './util/args.js';
import { scrape, writeJson } from './scrape.js';

const args = parseArgs(process.argv);

if (!args.q || !args.ll) {
  console.error(
    'Usage: node src/index.js --q=<query> --ll=@<lat>,<lon>,<zoom>z ' +
      '[--hl=en] [--out=output/result.json] [--raw=raw/] [--headful]'
  );
  process.exit(1);
}

const out = args.out || `output/${args.q.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.json`;
const rawDir = args.raw === true ? 'raw' : args.raw || null;

const t0 = Date.now();
try {
  const result = await scrape({
    q: args.q,
    ll: args.ll,
    hl: args.hl || 'en',
    headful: !!args.headful,
    rawDir,
  });
  await writeJson(out, result);
  const n = result.local_results.length;
  console.log(`✓ ${n} place${n === 1 ? '' : 's'} → ${out}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} catch (e) {
  console.error('✗ scrape failed:', e.message);
  process.exit(2);
}
