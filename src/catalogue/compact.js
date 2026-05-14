// Place → compact-card payload mapping.
//
// The full place doc in `places/{id}` is heavy (photos, reviews,
// extensions, operating_hours, raw scrape state). The mobile app's
// list/grid views only need a small subset to render a card; the
// detail page subscribes to `places/{id}` directly when the user
// opens it, getting the full payload then.
//
// We pre-roll the compact subset into the catalogue buckets so the
// mobile's home + category browsing is fast — one stream of
// `catalogue_buckets/*` (~2 MB total) instead of the full `places/`
// collection (~16 MB with all the rich fields).
//
// If you add a field that a place card needs, add it here AND update
// the mobile's CataloguePlace model so the round-trip type-checks.

/// Strip a full place record to the card-rendering fields.
///
/// Returns null when the input is unusable (no place_id, no title).
/// Callers should skip null entries — that signals a malformed doc
/// the scraper somehow produced (shouldn't happen, defensive).
export function toCompactPlace(place, { surfacedVia = 'identity' } = {}) {
  if (!place || typeof place !== 'object') return null;
  if (!place.place_id || !place.title) return null;

  const coords = place.gps_coordinates;
  return {
    place_id: place.place_id,
    title: place.title,
    type: place.type ?? null,
    address: place.address ?? null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviews: typeof place.reviews === 'number' ? place.reviews : null,
    thumbnail: place.thumbnail ?? null,
    first_seen_at: place.first_seen_at ?? null,
    last_scraped_at: place.last_scraped_at ?? null,
    open_state: place.open_state ?? null,
    price: place.price ?? null,
    weighted_rating:
        typeof place.weighted_rating === 'number' ? place.weighted_rating : null,
    sort_score:
        typeof place.sort_score === 'number' ? place.sort_score : null,
    attributes: place.attributes ?? {},
    // `lat` / `lng` (flat, not nested) so the mobile can decode without
    // a special-case object reader. Decoded from the existing
    // `gps_coordinates` nesting that the scraper writes.
    lat: typeof coords?.latitude === 'number' ? coords.latitude : null,
    lng: typeof coords?.longitude === 'number' ? coords.longitude : null,
    // Kept so the mobile's "Has X" chip logic can still check identity
    // membership ("this place IS a bank" vs "this place HAS an atm").
    source_categories: Array.isArray(place.source_categories)
        ? place.source_categories
        : [],
    /// 'identity' — appears in this bucket because its `source_categories`
    ///              overlaps the main's sub-slugs.
    /// 'attribute' — appears because of a cross-category flag (e.g. a
    ///              supermarket with `has_atm: true` in the Bank bucket).
    /// Lets the card render the "Has ATM" / "Has Pharmacy" chip without
    /// needing the full Place model.
    surfaced_via: surfacedVia,
  };
}
