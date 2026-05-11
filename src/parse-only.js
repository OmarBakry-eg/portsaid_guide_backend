// Parse saved raw captures without hitting Google again. Useful for fast iteration.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseGoogleResponse, pick, findArray } from './util/pb.js';
import { parsePlace } from './parsers/place.js';

const rawDir = process.argv[2] || 'raw';
const out = process.argv[3] || 'output/from-raw.json';

const files = readdirSync(rawDir).filter((f) => f.endsWith('.txt'));

const isResultTuple = (el) =>
  Array.isArray(el) && Array.isArray(el[1]) && typeof el[1][11] === 'string';

// Collect every place tuple across all captures, merging by place_id —
// keep the richest version (most non-null fields) for each unique place.
const orderedPlaceIds = [];
const byPlaceId = new Map();
for (const f of files) {
  let parsed;
  try {
    parsed = parseGoogleResponse(readFileSync(`${rawDir}/${f}`, 'utf8'));
  } catch (e) {
    console.log(`skip ${f}: ${e.message}`);
    continue;
  }
  // Gather tuples from BOTH shapes:
  // (A) list at parsed[64]/[65]/[63]
  // (B) single place at parsed[6]/[0]/[1]
  let tuples = [];
  for (const cand of [pick(parsed, 64), pick(parsed, 65), pick(parsed, 63)]) {
    if (Array.isArray(cand)) tuples = tuples.concat(cand.filter(isResultTuple));
  }
  if (!tuples.length) {
    for (const cand of [pick(parsed, 6), pick(parsed, 0), pick(parsed, 1)]) {
      if (Array.isArray(cand) && typeof cand[11] === 'string') {
        tuples.push([null, cand]);
        break;
      }
    }
  }

  for (const tup of tuples) {
    const p = tup[1];
    const pid = p?.[78] ?? p?.[10];
    if (!pid) continue;
    const nonNull = p.filter((v) => v != null).length;
    const existing = byPlaceId.get(pid);
    if (!existing) {
      byPlaceId.set(pid, { tuple: tup, rich: nonNull });
      orderedPlaceIds.push(pid);
    } else if (nonNull > existing.rich) {
      byPlaceId.set(pid, { tuple: tup, rich: nonNull });
    }
  }
}

const bestList = orderedPlaceIds.map((pid) => byPlaceId.get(pid).tuple);

console.log(`parsing ${bestList.length} results...`);
const local_results = [];
for (let i = 0; i < bestList.length; i++) {
  const place = parsePlace(bestList[i], i + 1);
  if (place) local_results.push(place);
}

const envelope = {
  search_metadata: { id: 'local-test', status: 'Success', source: 'replayed-raw' },
  search_parameters: { engine: 'google_maps', type: 'search' },
  search_information: {
    local_results_state: local_results.length ? 'Results for exact spelling' : 'No results',
  },
  local_results,
};

writeFileSync(out, JSON.stringify(envelope, null, 2));
console.log(`✓ ${local_results.length} → ${out}`);
console.log('\nFirst 3 places (compact preview):');
for (const r of local_results.slice(0, 3)) {
  const keys = Object.keys(r);
  console.log(`  ${r.position}. ${r.title}  (${keys.length} fields)`);
  console.log(`     rating=${r.rating} reviews=${r.reviews} price=${r.price || '-'}`);
  console.log(`     phone=${r.phone || '-'}`);
  console.log(`     website=${r.website || '-'}`);
  console.log(`     hours=${r.operating_hours ? Object.keys(r.operating_hours).length + ' days' : '-'}`);
  console.log(`     extensions=${r.extensions ? r.extensions.length + ' groups' : '-'}`);
  console.log(`     user_review="${r.user_review?.slice(0, 60) || '-'}"`);
}
