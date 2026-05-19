// Diagnostic: find every place in Firestore within a given radius of
// a target lat/lon, and optionally filter by title substring.
//
// Used to answer questions like "is this specific spot from Google
// Maps already in our store, and if so how is it classified?" — the
// first branch of the missing-place diagnostic tree (anchors vs.
// classifier vs. Google index).
//
// Usage:
//   FIRESTORE_PROJECT=port-said-guide \
//   GOOGLE_APPLICATION_CREDENTIALS=secrets/firebase-service-account.json \
//   node src/find-nearby.js \
//     --lat=31.2639 --lon=32.2728 \
//     [--radius-m=500]              # default 500m
//     [--query=ZAK]                 # case-insensitive substring on title/Arabic
//     [--limit=20]                  # default 20
//
// Output: for each match, prints title / type / primary_slug /
// source_categories / classification method+confidence / distance
// from target. Sorted by distance ascending.

import { parseArgs } from './util/args.js';
import { listAllPlaces } from './pipeline/firestore.js';

const args = parseArgs(process.argv);

const lat = parseFloat(args.lat);
const lon = parseFloat(args.lon);
if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error('✗ Pass --lat=<num> --lon=<num>. Both required.');
  process.exit(1);
}
const radiusM = parseFloat(args['radius-m'] ?? '500');
const query = (args.query ?? '').toLowerCase();
const limit = parseInt(args.limit ?? '20', 10);

if (!process.env.FIRESTORE_PROJECT) {
  console.error('✗ Set FIRESTORE_PROJECT env var (e.g. port-said-guide).');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('✗ Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.');
  process.exit(1);
}

console.log(`◆ scanning places near (${lat}, ${lon}) within ${radiusM} m${query ? ` matching "${query}"` : ''}`);

const places = await listAllPlaces();
console.log(`  ${places.length} total places in Firestore`);

// Haversine distance in metres. We only need this for ranking and
// the radius gate — accuracy at city scale (a few km tops) is well
// within meters either way.
function distMetres(la1, lo1, la2, lo2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(la2 - la1);
  const dLon = toRad(lo2 - lo1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const matches = [];
for (const p of places) {
  const pLat = p.gps_coordinates?.latitude;
  const pLon = p.gps_coordinates?.longitude;
  if (typeof pLat !== 'number' || typeof pLon !== 'number') continue;
  const d = distMetres(lat, lon, pLat, pLon);
  if (d > radiusM) continue;
  if (query) {
    const title = (p.title || '').toLowerCase();
    if (!title.includes(query)) continue;
  }
  matches.push({ p, d });
}

matches.sort((a, b) => a.d - b.d);
const shown = matches.slice(0, limit);

if (shown.length === 0) {
  console.log(`\n✗ No places found within ${radiusM}m${query ? ` matching "${query}"` : ''}.`);
  console.log('   This means the scraper has not seen anything here — likely an');
  console.log('   anchor-density / Google-index issue, not a classifier issue.');
  console.log('   Next step: run a manual scrape against this area to see what');
  console.log('   Google returns at higher zoom.');
  process.exit(0);
}

console.log(`\n✓ Found ${matches.length} place(s) within ${radiusM}m. Showing top ${shown.length}:\n`);

for (const { p, d } of shown) {
  const cats = (p.source_categories ?? []).join(', ') || '(none)';
  const cls = p.classification ?? {};
  const method = cls.method ?? '?';
  const conf = typeof cls.confidence === 'number'
    ? cls.confidence.toFixed(2)
    : '?';
  const reasoning = cls.reasoning ?? '(no reasoning)';
  console.log(`  ${d.toFixed(0).padStart(4)} m | ${p.title}`);
  console.log(`         type:       ${p.type ?? '(none)'}`);
  console.log(`         primary:    ${p.primary_slug ?? '(none)'}`);
  console.log(`         cats:       [${cats}]`);
  console.log(`         coords:     ${p.gps_coordinates?.latitude}, ${p.gps_coordinates?.longitude}`);
  console.log(`         rating:     ${p.rating ?? '—'} (${p.reviews ?? 0} reviews)`);
  console.log(`         class:      ${method} @ ${conf} — ${reasoning.slice(0, 100)}`);
  console.log();
}

console.log(`◆ Interpreting the result:`);
console.log(`   - If you expected one of these to be in a specific category tab`);
console.log(`     and it isn't, check primary_slug + source_categories vs. that tab's slug.`);
console.log(`     The classifier may need a rule or LLM-prompt nudge.`);
console.log(`   - If a place you expected near these coords is NOT in the list,`);
console.log(`     the scraper hasn't seen it — likely anchor coverage gap.`);
