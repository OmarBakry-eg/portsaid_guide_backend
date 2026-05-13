// Classifier vocabulary — the single source of truth for what slugs the
// pipeline is allowed to assign, what attributes it can detect, and the
// shape the LLM must return.
//
// Anytime a slug is added to config/categories.json it MUST also be added
// to KNOWN_SLUGS below, otherwise the validator will reject classifications
// that target it and the place will silently fall through to "other".
// CI lint that checks the two stay in sync is on the todo list.

/// Every slug the classifier is allowed to assign as a primary identity.
/// "other" is intentionally last — it's the only floor, used when the
/// classifier has zero confident match (see fit_for_queried_slug logic).
export const KNOWN_SLUGS = Object.freeze([
  // Food & drink
  'coffee', 'restaurant', 'fish-seafood', 'fast-food', 'bakery', 'dessert',
  // Lodging
  'hotel', 'hostel',
  // Health
  'pharmacy', 'hospital', 'clinic', 'dentist', 'veterinarian',
  // Shopping — general
  'supermarket', 'grocery', 'mall',
  // Shopping — clothing
  'clothing', 'clothing-men', 'clothing-women', 'clothing-kids', 'shoe-store',
  // Shopping — electronics & tech
  'electronics',
  // Shopping — specialty
  'candy-store', 'gift-shop', 'toy-store', 'bookstore', 'florist',
  'jewelry', 'stationery',
  // Money
  'atm', 'bank', 'money-exchange',
  // Auto
  'gas-station', 'car-wash', 'auto-repair', 'car-rental', 'parking',
  // Worship
  'mosque', 'church',
  // Entertainment & recreation
  'beach', 'park', 'cinema', 'gym', 'tourist-attr',
  // Education
  'school', 'university', 'library',
  // Government
  'police', 'post-office',
  // Transport
  'taxi', 'bus-station',
  // Floor — last-resort bucket for genuinely unclassifiable places
  'other',
]);

/// Cross-category feature flags. A place can have one or more of these
/// set true regardless of its primary slug — used by the app to surface
/// e.g. a supermarket in the Bank tab via `has_atm`.
///
/// Adding an attribute here makes it part of the LLM's required output
/// schema. The frontend decides which to act on.
export const ATTRIBUTE_KEYS = Object.freeze([
  'has_atm',
  'has_pharmacy',
  'has_wifi',
  'has_parking',
  'accepts_credit_cards',
]);

/// LLM relationship verdict — how the place fits the slug we scraped it
/// under. Drives whether we keep / drop the queried slug from
/// source_categories. See computeSourceCategories in `index.js`.
export const FIT_VERDICTS = Object.freeze([
  'strong',        // P really is a Q
  'loose',         // P is Q-adjacent — keep it under Q anyway
  'feature_only',  // P is NOT a Q but contains a Q feature (chip in UI)
  'unrelated',     // P has nothing to do with Q
]);

/// Method tag stored on each classified place so we can audit which
/// path the decision came from. Useful when an entry looks wrong and
/// we want to know whether to fix a rule or tune the LLM prompt.
export const CLASSIFICATION_METHODS = Object.freeze([
  'rules',        // Google type → slug map hit
  'heuristics',   // Name keyword / type[] / extensions matched a slug
  'llm',          // Groq LLM returned the classification
  'fallback',     // All LLM keys exhausted, used the conservative default
]);

/// JSON Schema we ask the LLM to conform to. Groq's JSON mode plus a
/// schema-aware prompt give us reliably parseable output.
export const LLM_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    primary_slug: {
      type: 'string',
      enum: [...KNOWN_SLUGS],
      description: 'The single slug that best matches this place\'s identity.',
    },
    fit_for_queried_slug: {
      type: 'string',
      enum: [...FIT_VERDICTS],
      description: 'How this place relates to the slug we scraped it under.',
    },
    attributes: {
      type: 'object',
      properties: Object.fromEntries(
        ATTRIBUTE_KEYS.map((k) => [k, { type: 'boolean' }])
      ),
      required: [...ATTRIBUTE_KEYS],
      additionalProperties: false,
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confidence in primary_slug, 0.0 to 1.0.',
    },
    reasoning: {
      type: 'string',
      description: 'One sentence explaining the decision. Stored for debug, not shown to users.',
    },
  },
  required: ['primary_slug', 'fit_for_queried_slug', 'attributes', 'confidence'],
  additionalProperties: false,
});

/// Confidence thresholds — the conservatism dial we tuned during the
/// design discussion.
export const THRESHOLDS = Object.freeze({
  /// Minimum confidence to commit to a curated slug (else → "other").
  ASSIGN_SLUG: 0.6,
  /// Minimum confidence to REMOVE a place from its currently-scraped
  /// category. High bar — we'd rather leave a slightly-off placement
  /// than incorrectly nuke a working one.
  REMOVE_FROM_QUERIED: 0.85,
});

/// Default empty attributes object — used as a safe baseline.
export const EMPTY_ATTRIBUTES = Object.freeze(
  Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, false]))
);
