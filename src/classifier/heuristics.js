// Heuristics — the middle tier of the classifier. Faster than calling
// the LLM, slower than a plain rule match. Used when:
//
//   - Google's `type` field is missing or in [`GENERIC_TYPES`]
//   - Rule-based lookup didn't find a confident slug
//   - AND we want a verdict before falling back to the LLM
//
// Also serves as the deterministic last-resort fallback when ALL four
// Groq keys are exhausted (see `classifier/index.js`). In that mode we
// accept lower confidence so we always return something usable.
//
// The scoring approach: count keyword hits per slug across `type`,
// `types[]`, and the place title (English + Arabic). Highest hit-count
// wins, ties broken by primary-`type` match. We deliberately keep this
// simple — the LLM is here for nuance; this layer is for "the name
// literally contains 'Pharmacy'".

import {
  GOOGLE_TYPE_TO_SLUG,
  GENERIC_TYPES,
  NAME_KEYWORD_TO_SLUG,
  ATTRIBUTE_SIGNALS,
} from './rules.js';
import { EMPTY_ATTRIBUTES } from './schema.js';

/// Look up a Google type string in the canonical map, case-insensitively.
/// Returns the matched slug or null. Skips generic types up-front so the
/// caller falls through to keyword heuristics for those.
export function slugFromGoogleType(type) {
  if (!type || typeof type !== 'string') return null;
  if (GENERIC_TYPES.has(type)) return null;
  // Exact-key match first (cheapest).
  if (GOOGLE_TYPE_TO_SLUG[type]) return GOOGLE_TYPE_TO_SLUG[type];
  // Case-insensitive fallback.
  const target = type.toLowerCase();
  for (const [k, v] of Object.entries(GOOGLE_TYPE_TO_SLUG)) {
    if (k.toLowerCase() === target) return v;
  }
  return null;
}

/// Look up a slug from `place.types[]` — first matched entry wins.
export function slugFromTypesArray(types) {
  if (!Array.isArray(types)) return null;
  for (const t of types) {
    const slug = slugFromGoogleType(t);
    if (slug) return slug;
  }
  return null;
}

/// Score how strongly each slug matches the place title via the
/// NAME_KEYWORD_TO_SLUG dictionary. Returns an object `{slug: hits}`.
/// Longer keyword matches outweigh single-word matches (a title that
/// literally contains "coffee shop" is more decisive than one that just
/// contains "coffee").
export function nameKeywordScores(title) {
  if (!title || typeof title !== 'string') return {};
  const lower = title.toLowerCase();
  const scores = {};
  for (const [kw, slug] of Object.entries(NAME_KEYWORD_TO_SLUG)) {
    if (lower.includes(kw.toLowerCase())) {
      // Longer matches score higher.
      const weight = kw.length >= 6 ? 2 : 1;
      scores[slug] = (scores[slug] ?? 0) + weight;
    }
  }
  return scores;
}

/// Detect cross-category attribute flags by checking type / types /
/// extensions / name for tell-tale substrings. Returns an attribute
/// object with all keys present (booleans).
export function detectAttributes(place) {
  const out = { ...EMPTY_ATTRIBUTES };

  const typeStr = (place.type || '').toLowerCase();
  const types = (Array.isArray(place.types) ? place.types : [])
    .map((t) => (t || '').toLowerCase());
  const name = (place.title || '').toLowerCase();
  // Extensions are a list of grouped feature objects in SerpApi shape:
  //   [{ "Service options": ["Has ATM", "Wheelchair accessible"] }, ...]
  // Flatten to a single string of feature labels for substring search.
  const extensionLabels = [];
  if (Array.isArray(place.extensions)) {
    for (const group of place.extensions) {
      if (group && typeof group === 'object') {
        for (const v of Object.values(group)) {
          if (Array.isArray(v)) {
            for (const item of v) extensionLabels.push(String(item).toLowerCase());
          }
        }
      }
    }
  }
  const extensionsBlob = extensionLabels.join(' | ');

  for (const [attr, sig] of Object.entries(ATTRIBUTE_SIGNALS)) {
    // Type-based: only fires if the place's PRIMARY identity isn't
    // already this attribute's category (a real ATM doesn't need
    // `has_atm: true`). Handled by the caller — here we just detect.
    const hitType = sig.type_substrings.some((s) =>
      typeStr.includes(s) || types.some((t) => t.includes(s))
    );
    const hitName = sig.name_substrings.some((s) => name.includes(s));
    const hitExt = sig.extension_substrings.some((s) => extensionsBlob.includes(s));
    if (hitType || hitName || hitExt) out[attr] = true;
  }

  return out;
}

/// Suppress attributes that are redundant with the place's primary slug.
/// A real bank doesn't need `has_atm: true`; the user already sees it
/// in the Bank tab via source_categories. Attributes only exist to
/// surface places that AREN'T their own primary in another tab.
export function dropRedundantAttributes(attributes, primarySlug) {
  const out = { ...attributes };
  if (primarySlug === 'bank' || primarySlug === 'atm') out.has_atm = false;
  if (primarySlug === 'pharmacy') out.has_pharmacy = false;
  return out;
}

/// Heuristic-only classification: produces a verdict without calling the
/// LLM. Confidence is bounded — heuristics top out at ~0.85 because we'd
/// rather defer to the LLM for nuanced cases.
///
/// `queriedSlug` is the slug the place was scraped under (e.g. "bank").
/// We use it to compute `fit_for_queried_slug`.
export function classifyByHeuristics(place, queriedSlug) {
  // 1. Try the canonical type map first.
  let primary = slugFromGoogleType(place.type);
  let conf = 0;
  let method = 'rules';
  if (primary) {
    conf = 0.95;
  } else {
    // 2. Fall back to the types[] array.
    primary = slugFromTypesArray(place.types);
    if (primary) conf = 0.85;
  }
  if (!primary) {
    // 3. Name keyword heuristics — the part the user emphasised. A place
    //    named "Information Bank Café" matches `coffee` via "café" in the
    //    name, not `bank`.
    const scores = nameKeywordScores(place.title);
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (ranked.length) {
      primary = ranked[0][0];
      // Confidence scales with hit weight, capped at 0.8 so the LLM
      // still gets a chance to override for ambiguous names.
      conf = Math.min(0.8, 0.55 + ranked[0][1] * 0.1);
      method = 'heuristics';
    }
  }

  // 4. Attributes (cross-category flags). Computed regardless of whether
  //    we found a primary slug — relevant even if we end up at "other".
  const rawAttrs = detectAttributes(place);
  const attributes = dropRedundantAttributes(rawAttrs, primary);
  const hasAnyAttr = Object.values(attributes).some(Boolean);

  // 5. Fit verdict for the queried slug — same conservative rules as
  //    the LLM uses, computed deterministically here.
  let fit;
  if (!queriedSlug || !primary) {
    fit = 'unrelated';
  } else if (primary === queriedSlug) {
    fit = 'strong';
  } else if (attributesIndicateSlug(attributes, queriedSlug)) {
    fit = 'feature_only';
  } else if (isLooselyRelated(primary, queriedSlug)) {
    fit = 'loose';
  } else {
    fit = 'unrelated';
  }

  return {
    primary_slug: primary, // may be null — caller decides whether to fall through to LLM
    fit_for_queried_slug: fit,
    attributes,
    confidence: conf,
    method,
    reasoning:
      primary
        ? `Resolved ${primary} from ${method === 'rules' ? 'Google type' : 'name keywords'}` +
          (hasAnyAttr ? ' + detected attributes' : '')
        : 'No primary slug from rules or heuristics',
  };
}

/// Does the attribute set indicate the place provides the queried slug
/// as a *feature* (e.g. supermarket scraped under "bank" with has_atm)?
function attributesIndicateSlug(attributes, slug) {
  if (slug === 'bank' || slug === 'atm') return attributes.has_atm === true;
  if (slug === 'pharmacy') return attributes.has_pharmacy === true;
  return false;
}

/// Manually curated "these slugs are adjacent, keep the queried one"
/// list. Used by computeSourceCategories: when a place's primary is
/// in this map AND the queried slug is one of the listed neighbors,
/// the queried slug is kept (fit = "loose"). Otherwise the queried
/// slug is dropped, regardless of confidence.
///
/// Curation principle: keep only TRUE family hierarchies — categories
/// users would reasonably expect to see overlapping. Cross-category
/// adjacency (cinema↔mall, gym↔park, electronics↔mall, bank↔money-
/// exchange) is removed: those produced wrong placements in the wild
/// (e.g. supermarkets and clinics ending up in the Cinemas tab via
/// the loose-neighbor escape hatch). Real banks belong only in Bank;
/// real cinemas only in Cinema. Period.
///
/// Cross-category SURFACING via attributes (e.g. supermarket-with-ATM
/// appearing in the Bank tab with a "Has ATM" chip) is preserved
/// separately by ATTRIBUTE_SURFACING in catalogue/bucket.js. That
/// path is structured (the mobile renders a chip to disambiguate);
/// LOOSE_NEIGHBORS is unstructured (no chip) which is why misuse
/// there caused visible contamination.
const LOOSE_NEIGHBORS = Object.freeze({
  // Money — atm and bank are interchangeable for browsing.
  // money-exchange is a different service; not a neighbor.
  bank: ['atm'],
  atm: ['bank'],
  'money-exchange': [],

  // Food family — fast-food and fish-seafood are kinds of restaurants.
  // Coffee is its own thing (not a restaurant), but bakery/dessert are
  // close enough to a coffee shop to surface together.
  restaurant: ['fast-food', 'fish-seafood'],
  'fast-food': ['restaurant'],
  'fish-seafood': ['restaurant'],
  coffee: ['bakery', 'dessert'],
  bakery: ['dessert', 'coffee'],
  dessert: ['bakery', 'candy-store', 'coffee'],
  'candy-store': ['dessert'],

  // Healthcare hierarchy.
  hospital: ['clinic'],
  clinic: ['hospital', 'dentist'],
  dentist: ['clinic'],

  // Grocery hierarchy. Mall is a different concept (multi-tenant
  // shopping building), not a synonym for supermarket — removed.
  supermarket: ['grocery'],
  grocery: ['supermarket'],
  mall: [],

  // Clothing — true subcategories.
  clothing: ['clothing-men', 'clothing-women', 'clothing-kids', 'shoe-store'],
  'clothing-men': ['clothing', 'shoe-store'],
  'clothing-women': ['clothing', 'shoe-store'],
  'clothing-kids': ['clothing', 'shoe-store', 'toy-store'],
  'shoe-store': ['clothing'],

  // Lodging.
  hotel: ['hostel'],
  hostel: ['hotel'],

  // Outdoor recreation — beach and park genuinely overlap (both are
  // open-air leisure spaces). tourist-attr / gym / cinema are distinct
  // and were producing junk; removed.
  park: ['beach'],
  beach: ['park'],
  gym: [],
  cinema: [],
  'tourist-attr': [],

  // Worship — strictly siloed.
  mosque: [],
  church: [],

  // Education.
  school: ['university', 'library'],
  university: ['school', 'library'],
  library: ['school', 'university', 'bookstore'],

  // Tech / specialty — these are distinct categories.
  electronics: [],
});

function isLooselyRelated(primary, queried) {
  if (!primary || !queried) return false;
  return (LOOSE_NEIGHBORS[primary] || []).includes(queried);
}
