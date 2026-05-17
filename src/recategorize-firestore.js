// One-shot: walk every place doc in Firestore, run the hybrid classifier,
// and either:
//   --dry-run   write a `output/migration-plan.json` artefact showing
//               what *would* change. No Firestore writes.
//   --apply     read the most recent dry-run plan and apply it. Refuses
//               to run if no plan exists, or the plan is >24h old.
//
// Usage:
//   GROQ1=... GROQ2=... GROQ3=... GROQ4=... \
//   FIRESTORE_PROJECT=port-said-guide \
//   GOOGLE_APPLICATION_CREDENTIALS=secrets/firebase-service-account.json \
//   node src/recategorize-firestore.js --dry-run
//
//   # then eyeball output/migration-plan.json
//   node src/recategorize-firestore.js --apply
//
// Both modes are idempotent. Re-running --dry-run produces a new plan;
// --apply only writes the deltas the plan describes.
//
// The plan covers THREE kinds of action:
//   1. CATEGORIZATION CHANGES — places whose source_categories /
//      attributes need updating under the current classifier rules.
//   2. DELETIONS — places that no longer pass isAccepted under the
//      current rules (typically the strict geo-fence: places without
//      coordinates or outside the Port Said bbox, which were the
//      cross-region pollution vector).
//   3. INDEX REBUILD — after any moves/deletions, `--apply`
//      regenerates catalogue_buckets + catalogue_meta/index +
//      meta/place_types so the mobile app sees the cleaned state.
//
// Cost: full migration of ~3,600 docs hits the LLM for the ~20-30% the
// rules+heuristics can't classify alone. At Groq free-tier prices that's
// ~$0 per migration. Steady-state cron runs only re-classify changed
// places (signature-cached on the doc), so the LLM is essentially never
// invoked once the catalogue stabilises.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { classify } from './classifier/index.js';
import { isAccepted } from './parsers/scoring.js';
import { buildCatalogue } from './catalogue/bucket.js';
import {
  listAllPlaces,
  writeCatalogue,
  writePlaceTypesIndex,
} from './pipeline/firestore.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const APPLY = args.includes('--apply');

if (DRY === APPLY) {
  console.error('✗ Pass exactly one of --dry-run or --apply.');
  process.exit(1);
}

const projectId = process.env.FIRESTORE_PROJECT;
if (!projectId) {
  console.error('✗ Set FIRESTORE_PROJECT env var (e.g. port-said-guide).');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('✗ Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.');
  process.exit(1);
}

const PLAN_PATH = new URL('../output/migration-plan.json', import.meta.url).pathname;
const PLAN_STALE_MS = 24 * 60 * 60 * 1000; // 24h

const admin = await import('firebase-admin');
if (!admin.default.apps.length) {
  admin.default.initializeApp({
    credential: admin.default.credential.applicationDefault(),
    projectId,
  });
}
const db = admin.default.firestore();
db.settings({ ignoreUndefinedProperties: true });

if (DRY) {
  await runDryRun();
} else {
  await runApply();
}

// ── dry-run ─────────────────────────────────────────────────────────

async function runDryRun() {
  const t0 = Date.now();
  console.log(`◆ recategorize dry-run on ${projectId}`);

  const snap = await db.collection('places').get();
  console.log(`  ${snap.size} docs read`);

  const plan = {
    generated_at: new Date().toISOString(),
    project: projectId,
    total_docs_evaluated: snap.size,
    summary: {
      unchanged: 0,
      category_corrected: 0,
      attribute_added: 0,
      moved_to_other: 0,
      invalid_geo_or_quality: 0,
      classifier_method: { rules: 0, heuristics: 0, llm: 0, fallback: 0 },
    },
    moves: [],
    deletions: [],
  };

  let i = 0;
  for (const doc of snap.docs) {
    i += 1;
    const data = doc.data();

    // Strict geo-fence + quality check. Places without coordinates,
    // outside the Port Said bbox, or with quality_score < threshold
    // get marked for deletion rather than reclassification.
    if (!isAccepted(data)) {
      plan.summary.invalid_geo_or_quality += 1;
      plan.deletions.push({
        place_id: doc.id,
        title: data.title ?? '(no name)',
        type: data.type ?? null,
        coords: data.gps_coordinates ?? null,
        reason: deletionReason(data),
      });
      continue;
    }

    // Reclassify regardless of cache — this is a full re-audit. The
    // queried slug is "unknown" here; we don't have the original query
    // context for already-stored docs. The classifier handles that by
    // not adding a queried slug to source_categories — so the place
    // surfaces only under its true primary_slug, exactly the strict
    // membership behavior we want for the cleanup.
    let cls;
    try {
      cls = await classify(data, /* queriedSlug = */ null);
    } catch (err) {
      console.error(`\n✗ classify failed for ${doc.id}: ${err.message}`);
      continue;
    }

    plan.summary.classifier_method[cls.classification.method] += 1;

    const before = {
      source_categories: data.source_categories ?? [],
      attributes: data.attributes ?? {},
    };
    const after = {
      source_categories: cls.source_categories,
      attributes: cls.attributes,
    };

    const catChanged = !arraysEqual(before.source_categories, after.source_categories);
    const attrChanged = !attrsEqual(before.attributes, after.attributes);

    if (!catChanged && !attrChanged) {
      plan.summary.unchanged += 1;
    } else {
      if (catChanged) plan.summary.category_corrected += 1;
      if (attrChanged) plan.summary.attribute_added += 1;
      if (
        after.source_categories.length === 1 &&
        after.source_categories[0] === 'other' &&
        !(before.source_categories.length === 1 && before.source_categories[0] === 'other')
      ) {
        plan.summary.moved_to_other += 1;
      }
      plan.moves.push({
        place_id: doc.id,
        title: data.title ?? '(no name)',
        type: data.type ?? null,
        from: {
          source_categories: before.source_categories,
          attributes: before.attributes,
        },
        to: {
          source_categories: after.source_categories,
          attributes: after.attributes,
          primary_slug: cls.primary_slug,
        },
        method: cls.classification.method,
        confidence: cls.classification.confidence,
        reasoning: cls.classification.reasoning,
      });
    }

    if (i % 25 === 0 || i === snap.size) {
      process.stdout.write(
        `\r  ${i}/${snap.size}  ` +
          `[unchanged ${plan.summary.unchanged}, ` +
          `corrected ${plan.summary.category_corrected}, ` +
          `→other ${plan.summary.moved_to_other}, ` +
          `delete ${plan.summary.invalid_geo_or_quality}]  ` +
          `(${((Date.now() - t0) / 1000).toFixed(0)}s)`
      );
    }
  }
  process.stdout.write('\n');

  await mkdir(new URL('../output/', import.meta.url).pathname, { recursive: true });
  await writeFile(PLAN_PATH, JSON.stringify(plan, null, 2));

  console.log(`✓ wrote ${PLAN_PATH}`);
  console.log(
    `  unchanged ${plan.summary.unchanged}, ` +
      `corrected ${plan.summary.category_corrected}, ` +
      `attr-added ${plan.summary.attribute_added}, ` +
      `→other ${plan.summary.moved_to_other}, ` +
      `delete ${plan.summary.invalid_geo_or_quality}`
  );
  console.log(
    `  classifier method: rules ${plan.summary.classifier_method.rules}, ` +
      `heuristics ${plan.summary.classifier_method.heuristics}, ` +
      `llm ${plan.summary.classifier_method.llm}, ` +
      `fallback ${plan.summary.classifier_method.fallback}`
  );
  console.log('  Review the plan, then run with --apply to commit.');
}

// ── apply ───────────────────────────────────────────────────────────

async function runApply() {
  if (!existsSync(PLAN_PATH)) {
    console.error(`✗ No plan found at ${PLAN_PATH}. Run --dry-run first.`);
    process.exit(2);
  }
  const plan = JSON.parse(await readFile(PLAN_PATH, 'utf8'));

  const ageMs = Date.now() - new Date(plan.generated_at).getTime();
  if (ageMs > PLAN_STALE_MS) {
    console.error(
      `✗ Plan is ${(ageMs / 3600_000).toFixed(1)}h old (limit: 24h). ` +
        `Regenerate with --dry-run first.`
    );
    process.exit(3);
  }

  const deletions = plan.deletions ?? [];
  console.log(
    `◆ applying ${plan.moves.length} moves + ${deletions.length} deletions ` +
      `from plan generated ${(ageMs / 60_000).toFixed(0)} min ago`
  );

  let batch = db.batch();
  let inBatch = 0;
  let writtenMoves = 0;
  let writtenDeletes = 0;
  const BATCH_LIMIT = 400;

  async function flush(kind) {
    if (inBatch === 0) return;
    await batch.commit();
    if (kind === 'moves') writtenMoves += inBatch;
    else if (kind === 'deletes') writtenDeletes += inBatch;
    batch = db.batch();
    inBatch = 0;
  }

  // Phase 1: category updates.
  for (const move of plan.moves) {
    const ref = db.collection('places').doc(move.place_id);
    batch.update(ref, {
      source_categories: move.to.source_categories,
      attributes: move.to.attributes,
      primary_slug: move.to.primary_slug,
      classification: {
        method: move.method,
        confidence: move.confidence,
        reasoning: move.reasoning,
        migrated_at: new Date().toISOString(),
        migrated_from_plan: plan.generated_at,
      },
    });
    inBatch += 1;
    if (inBatch >= BATCH_LIMIT) {
      await flush('moves');
      process.stdout.write(`\r  moves ${writtenMoves}/${plan.moves.length}`);
    }
  }
  await flush('moves');
  process.stdout.write(`\r  moves ${writtenMoves}/${plan.moves.length}\n`);

  // Phase 2: deletions. Each delete is one write op against quota,
  // but typically the deletion count is small (geo-fence violators).
  for (const del of deletions) {
    const ref = db.collection('places').doc(del.place_id);
    batch.delete(ref);
    inBatch += 1;
    if (inBatch >= BATCH_LIMIT) {
      await flush('deletes');
      process.stdout.write(`\r  deletes ${writtenDeletes}/${deletions.length}`);
    }
  }
  await flush('deletes');
  process.stdout.write(`\r  deletes ${writtenDeletes}/${deletions.length}\n`);

  console.log(`✓ applied ${writtenMoves} updates + ${writtenDeletes} deletions`);

  // Phase 3: rebuild the derived indexes from the cleaned Firestore
  // state. Skips if no actual changes happened (saves quota when the
  // dry-run plan was empty / no-op).
  if (writtenMoves === 0 && writtenDeletes === 0) {
    console.log('◆ no changes — skipping index rebuild');
    return;
  }

  console.log('◆ rebuilding meta/place_types index from cleaned state');
  // One listAllPlaces() here is necessary — we need the post-change
  // state, and the script doesn't have an in-memory copy. ~3,600 reads
  // is a one-shot cost we accept for a manual cleanup.
  const fresh = await listAllPlaces();
  const idx = await writePlaceTypesIndex({ from: fresh });
  console.log(
    `✓ meta/place_types updated — ${idx.type_count} distinct types across ${idx.total_places} places`
  );

  console.log('◆ rebuilding catalogue (buckets + meta/index)');
  const catalogue = buildCatalogue(fresh);
  const result = await writeCatalogue(catalogue);
  console.log(
    `✓ catalogue updated — ${result.bucket_count} buckets across ` +
      `${result.main_count} mains, ${result.total_places} places`
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const A = [...a].sort();
  const B = [...b].sort();
  return A.every((v, i) => v === B[i]);
}

function attrsEqual(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    if ((a?.[k] === true) !== (b?.[k] === true)) return false;
  }
  return true;
}

/// Best-guess human-readable explanation of why isAccepted rejected a
/// place. Used for the deletion plan so the user can spot-check before
/// running --apply.
function deletionReason(place) {
  if (!place || typeof place.title !== 'string' || !place.title.trim()) {
    return 'missing or empty title';
  }
  const lat = place.gps_coordinates?.latitude;
  const lon = place.gps_coordinates?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return 'no coordinates (unverifiable location)';
  }
  // Hardcoded bbox — keep in sync with PORT_SAID_BOUNDS in scoring.js.
  if (lat < 31.10 || lat > 31.35 || lon < 32.20 || lon > 32.40) {
    return `outside Port Said bbox (lat=${lat}, lon=${lon})`;
  }
  return 'quality_score below threshold';
}
