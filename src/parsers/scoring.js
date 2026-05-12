// Trust + ranking signals computed for every Place document.
//
// Goal: surface places that are real, useful, and well-reviewed before the
// ones with sparse data or suspiciously few ratings. Filters out documents
// that look like spam / mis-categorised junk (a person's name pinned as a
// "coffee shop", a Google-Place with zero verifiable metadata, etc.).

// ── Tunable constants ─────────────────────────────────────────────────

/// IMDb-style Bayesian smoothing: how many reviews we need before we trust
/// a place's rating fully. With m=20, three reviews carry far less weight
/// than three thousand.
const BAYES_M = 20;

/// Conservative city-wide rating prior. Pulls newcomers toward 4.0 — so a
/// suspicious 5.0★ × 1-review place doesn't out-rank a 4.7★ × 1,000.
const BAYES_PRIOR = 4.0;

/// Filtering threshold. A place needs at least this many quality points to
/// appear in the app at all. Empirically:
///   - 20 keeps gas-stations / ATMs / pharmacies with zero reviews (real
///     places that nobody bothers reviewing), drops obvious junk.
///   - 30 also drops legitimate-but-thin entries — too aggressive.
/// Tradeoff favours false negatives (some junk slipping through but sinking
/// to the bottom of the sort) over false positives (dropping real places).
export const QUALITY_THRESHOLD = 20;

/// Penalty applied to `sort_score` when a place has no thumbnail. Big enough
/// that a 4.7★-without-photo sorts below a 4.0★-with-photo.
const NO_PHOTO_PENALTY = 0.7;

/// Port Said + Port Fouad bounding box. Anything outside is wrong-city
/// pollution from Google's index — drop it.
const PORT_SAID_BOUNDS = {
  minLat: 31.10,
  maxLat: 31.35,
  minLon: 32.20,
  maxLon: 32.40,
};

// ── Public API ────────────────────────────────────────────────────────

/// IMDb-style Bayesian rating. Pulls low-vote ratings toward the prior so a
/// 5★ × 3 reviews place doesn't beat a 4.7★ × 3,000.
export function weightedRating({ rating, reviews }) {
  if (typeof rating !== 'number' || rating <= 0) return undefined;
  const v = typeof reviews === 'number' && reviews >= 0 ? reviews : 0;
  return (v / (v + BAYES_M)) * rating + (BAYES_M / (v + BAYES_M)) * BAYES_PRIOR;
}

/// 0-100 trust score built from data-completeness + community signals.
/// Each "yes" adds to the total; max is 100.
export function qualityScore(place) {
  let score = 0;
  if (place.thumbnail) score += 25;
  if (place.address) score += 15;
  if (place.phone || place.website) score += 10;
  if (place.operating_hours && Object.keys(place.operating_hours).length > 0) {
    score += 10;
  }
  if (Array.isArray(place.extensions) && place.extensions.length > 0) {
    score += 10;
  }
  const reviews = place.reviews ?? 0;
  if (reviews >= 1) score += 10;
  if (reviews >= 5) score += 10;
  if (reviews >= 50) score += 10;
  return score;
}

/// Composite sort key. Higher = ranked higher. Combines weighted rating
/// with a photo-presence boost so visually-poor places drift to the bottom.
export function sortScore(place, weighted) {
  if (typeof weighted !== 'number') return 0;
  const photoBonus = place.thumbnail ? 0 : -NO_PHOTO_PENALTY;
  return weighted + photoBonus;
}

/// True when the place looks real enough to show in the app.
export function isAccepted(place) {
  if (!place || typeof place.title !== 'string' || !place.title.trim()) {
    return false;
  }

  // Geo-fence: must be inside the Port Said bounding box. Many junk pins
  // have no coords at all — accept those for now but rely on quality_score
  // to filter them.
  const lat = place.gps_coordinates?.latitude;
  const lon = place.gps_coordinates?.longitude;
  if (typeof lat === 'number' && typeof lon === 'number') {
    if (
      lat < PORT_SAID_BOUNDS.minLat ||
      lat > PORT_SAID_BOUNDS.maxLat ||
      lon < PORT_SAID_BOUNDS.minLon ||
      lon > PORT_SAID_BOUNDS.maxLon
    ) {
      return false;
    }
  }

  if (qualityScore(place) < QUALITY_THRESHOLD) return false;

  return true;
}

/// Compute all derived fields and attach them to the place. Mutates and
/// returns the same object for convenience. Idempotent — safe to re-run.
export function enrichWithScores(place) {
  const wr = weightedRating(place);
  place.weighted_rating = wr;
  place.quality_score = qualityScore(place);
  place.sort_score = sortScore(place, wr);
  return place;
}
