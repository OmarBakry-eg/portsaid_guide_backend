// Classifier entrypoint — the hybrid pipeline that decides every
// place's source_categories and attributes.
//
// Tiered to minimise LLM cost and latency:
//
//   1. RULES        — Google `type` field maps directly to a known slug.
//                     Fires ~70-80% of the time. Free, instant, deterministic.
//   2. HEURISTICS   — `types[]` array, name keywords (English + Arabic),
//                     extension labels. Fires when `type` is missing/generic.
//                     Still free, still deterministic, but lower confidence.
//   3. LLM          — Only invoked when rules + heuristics return low
//                     confidence. Groq llama-3.1-8b-instant via 4-key
//                     rotation. ~$0.04 per 1k calls.
//   4. FALLBACK     — All four Groq keys exhausted? Use the heuristic
//                     verdict regardless of confidence. Marks classification
//                     method as "fallback" so we can audit how often we
//                     end up here. In practice this should be near-zero.
//
// The pipeline output is then mapped to:
//   - primary_slug — the place's canonical identity
//   - source_categories — what tabs the place appears in
//   - attributes — what features the place has (has_atm, etc.)
//   - classification — debug metadata stored on the doc
//
// computeSourceCategories implements the conservatism rule we landed on
// during the design discussion:
//   - "strong" / "loose" → keep the queried slug
//   - "feature_only" / "unrelated" → primary slug only
//
// See schema.js for the slug list and confidence thresholds.

import { createHash } from 'node:crypto';
import { classifyByHeuristics, dropRedundantAttributes } from './heuristics.js';
import { classifyWithGroq, llmIsAvailable } from './groq.js';
import { EMPTY_ATTRIBUTES, KNOWN_SLUGS, THRESHOLDS } from './schema.js';

/// Top-level: classify one place. Returns an object the pipeline can
/// merge straight onto the Firestore doc.
///
/// @param place        - the scraped place (post-parsing, pre-merge)
/// @param queriedSlug  - the slug we scraped this place under
/// @returns
///   {
///     primary_slug,
///     source_categories: string[],
///     attributes: { has_atm: bool, ... },
///     classification: { method, model, confidence, signature, classified_at, reasoning? }
///   }
export async function classify(place, queriedSlug) {
  const now = new Date().toISOString();
  const signature = computeSignature(place);

  // Tier 1+2: heuristics (rules layered inside). Cheap, deterministic.
  const heur = classifyByHeuristics(place, queriedSlug);

  // If heuristics gave us a confident primary slug, we're done.
  if (heur.primary_slug && heur.confidence >= 0.85) {
    return assemble({
      primary: heur.primary_slug,
      fit: heur.fit_for_queried_slug,
      attributes: heur.attributes,
      confidence: heur.confidence,
      method: heur.method,
      model: null,
      reasoning: heur.reasoning,
      queriedSlug,
      signature,
      classified_at: now,
    });
  }

  // Tier 3: LLM. Only when heuristics couldn't commit.
  if (llmIsAvailable()) {
    try {
      const llm = await classifyWithGroq({ place, queriedSlug });
      const attrs = dropRedundantAttributes(llm.attributes, llm.primary_slug);
      return assemble({
        primary: llm.primary_slug,
        fit: llm.fit_for_queried_slug,
        attributes: attrs,
        confidence: llm.confidence,
        method: llm.method,
        model: llm.model,
        reasoning: llm.reasoning,
        queriedSlug,
        signature,
        classified_at: now,
        key_used: llm.key_used,
      });
    } catch (err) {
      // All keys exhausted, or LLM unreachable. Fall through to the
      // heuristic verdict — at lower confidence — rather than returning
      // nothing. Marks `method: 'fallback'` so we can audit.
      // (`err.message === 'all_keys_exhausted'` is the expected path.)
    }
  }

  // Tier 4: fallback. Use whatever heuristics produced even if it had
  // low confidence. If even heuristics found nothing, route to "other".
  const primary = heur.primary_slug ?? 'other';
  const conf = heur.primary_slug ? Math.max(heur.confidence, 0.4) : 0.3;
  const attrs = dropRedundantAttributes(heur.attributes, primary);
  return assemble({
    primary,
    fit: heur.fit_for_queried_slug,
    attributes: attrs,
    confidence: conf,
    method: 'fallback',
    model: null,
    reasoning: heur.primary_slug
      ? `LLM unavailable; using heuristic verdict (${heur.method})`
      : 'LLM unavailable and no heuristic match — routing to other',
    queriedSlug,
    signature,
    classified_at: now,
  });
}

/// Pull it all together into the shape `normalize.js` expects to merge
/// onto the place document.
function assemble({
  primary,
  fit,
  attributes,
  confidence,
  method,
  model,
  reasoning,
  queriedSlug,
  signature,
  classified_at,
  key_used,
}) {
  // If our confident primary is below the threshold for a curated slug,
  // demote to "other". This is the floor we agreed on — "other" only
  // when nothing else fits.
  const finalPrimary =
    confidence >= THRESHOLDS.ASSIGN_SLUG && KNOWN_SLUGS.includes(primary)
      ? primary
      : 'other';

  const source_categories = computeSourceCategories({
    primary: finalPrimary,
    fit,
    queriedSlug,
    confidence,
  });

  return {
    primary_slug: finalPrimary,
    source_categories,
    attributes: { ...EMPTY_ATTRIBUTES, ...attributes },
    classification: {
      method,
      model,
      confidence,
      signature,
      classified_at,
      // `reasoning` is debug-only — kept short, never shown to users.
      reasoning: reasoning || '',
      ...(key_used ? { key_used } : {}),
    },
  };
}

/// Decide which slugs land in source_categories.
///
/// Strict membership rule:
///   - Primary slug is always included.
///   - Queried slug is kept ONLY when fit is "strong" or "loose"
///     (loose = same family, e.g. fast-food under restaurant; see
///     LOOSE_NEIGHBORS in heuristics.js).
///   - Queried slug is DROPPED for "feature_only" and "unrelated",
///     regardless of confidence.
///
/// Rationale: the previous policy kept the queried slug as a "safety
/// net" when the classifier's confidence was below
/// THRESHOLDS.REMOVE_FROM_QUERIED. That produced clinics-in-cinemas,
/// supermarkets-in-banks, fast-food-in-cinemas, etc., because a
/// confidence of e.g. 0.75 ("I'm 75% sure this clinic is unrelated to
/// cinema") was treated as "not sure enough, leave it in." It should
/// have been "75% sure → drop it." We now drop, period.
///
/// "feature_only" still gets dropped from source_categories — the
/// feature is captured in the attributes object (has_atm, has_pharmacy)
/// and surfaced via ATTRIBUTE_SURFACING in catalogue/bucket.js, which
/// preserves the cross-category UX without contaminating the primary
/// list.
export function computeSourceCategories({ primary, fit, queriedSlug, confidence }) {
  const set = new Set([primary]);

  // No queried slug context (e.g. migration script processing a doc
  // whose original query is unknown) → just use the primary.
  if (!queriedSlug) return [...set];

  // Strict: only keep the queried slug for "strong" or "loose" fits.
  // Anything else (feature_only, unrelated) gets dropped regardless
  // of confidence — we'd rather have a place in "other" or its true
  // primary bucket than incorrectly tagged in the wrong category.
  if (fit === 'strong' || fit === 'loose') {
    set.add(queriedSlug);
  }
  // Reference `confidence` so older callers don't break — it's no
  // longer the deciding factor for queried-slug retention, but it
  // remains on the classification doc for telemetry.
  void confidence;

  return [...set].sort();
}

/// Stable signature for cache invalidation. If a place's identifying
/// signal changes (name, type, types[], extensions, address) we want to
/// re-classify; otherwise the previous decision is still valid.
///
/// The `v` field is a classifier-rules version tag — bump it whenever
/// LOOSE_NEIGHBORS, the LLM prompt, or computeSourceCategories changes
/// in a way that should retroactively re-classify already-stored
/// places. Stored signatures from older `v` values will never match
/// the current one, forcing one round of re-classification across
/// every place the cron sees.
///
/// v history:
///   1 — initial schema (implicit, signatures didn't carry a version)
///   2 — strict membership: drop unrelated/feature_only from
///       source_categories regardless of confidence; pruned
///       LOOSE_NEIGHBORS; rewritten LLM prompt; ATTRIBUTE_SURFACING
///       removed. Bumped 2026-05.
///   3 — mergePlace no longer pre-tags places with the queried slug
///       (was the source of cinema/bank tab regressions when the
///       signature-cache skipped re-classification). Bumping the
///       version forces one round of clean re-classification across
///       every scraped place on the next cron, scrubbing any
///       lingering wrong-tab tags written before the mergePlace fix.
export function computeSignature(place) {
  const payload = JSON.stringify({
    v: 3,
    title: place.title || '',
    type: place.type || '',
    types: Array.isArray(place.types) ? place.types : [],
    address: place.address || '',
    extensions_len: Array.isArray(place.extensions) ? place.extensions.length : 0,
    reviews_len: Array.isArray(place.reviews_data) ? place.reviews_data.length : 0,
  });
  return createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

/// Does this place need re-classification, given a previous classification
/// record? Returns true when the signature has changed (or no previous
/// classification exists).
export function needsReclassification(place, previousClassification) {
  if (!previousClassification?.signature) return true;
  return computeSignature(place) !== previousClassification.signature;
}
