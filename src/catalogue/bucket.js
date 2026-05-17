// Build the bucketed catalogue from a flat list of places.
//
// The output is the canonical "view" of the catalogue the mobile app
// presents: a 2-level grouping by main category → sub-category →
// compact place list. Every "browse" surface in the app — the home
// grid, the main-cat sub-list, the sub-cat place list — reads from
// this structure verbatim. No client-side bucketing required.
//
// Rules of placement:
//   1. Identity: a place lands in (main, sub) iff `sub` is one of the
//      main's curated sub-slugs AND the place's `source_categories`
//      contains `sub`. Yes a place can land in multiple buckets — a
//      "Bookstore Café" tagged ["bookstore", "coffee"] appears in
//      both Shopping > Bookstore and Food > Coffee.
//   2. Attribute surfacing: places with `attributes.has_atm = true`
//      that aren't already in `bank`/`atm` get added there with
//      `surfaced_via: 'attribute'`. Same for `has_pharmacy` → `pharmacy`.
//      This is what powers the "Has ATM" chip on cards in the Bank tab.
//   3. Other main is dynamic: places whose `source_categories` don't
//      overlap ANY curated sub-slug land in Other. Other's sub-buckets
//      are built from `place.type` groupings — topN most common types
//      get their own sub, the rest fall into `misc`.
//
// The function is pure: takes places, returns the structured output.
// `writeCatalogue` in `pipeline/firestore.js` handles persistence.

import { toCompactPlace } from './compact.js';

/// Curated main categories — MUST mirror `lib/core/util/category_catalog.dart`
/// on the mobile side. Adding / renaming entries here requires the same
/// edit on the mobile, otherwise mobile won't know the slug.
///
/// Mains carry icon / colour metadata in the mobile catalog; here we
/// only need slug + the list of sub-slugs that resolve to "this main
/// claims this sub". Other is special: see [_otherSubs] below.
export const MAIN_CATEGORIES = Object.freeze([
  {
    slug: 'food',
    subSlugs: [
      'coffee', 'restaurant', 'fast-food', 'fish-seafood',
      'bakery', 'dessert', 'candy-store',
    ],
  },
  {
    slug: 'shopping',
    subSlugs: [
      'supermarket', 'grocery', 'mall', 'electronics',
      'clothing', 'clothing-women', 'clothing-men', 'clothing-kids',
      'shoe-store', 'jewelry', 'bookstore', 'stationery',
      'gift-shop', 'toy-store', 'florist',
    ],
  },
  {
    slug: 'health',
    subSlugs: ['pharmacy', 'clinic', 'hospital', 'dentist', 'veterinarian'],
  },
  { slug: 'stay', subSlugs: ['hotel', 'hostel'] },
  { slug: 'finance', subSlugs: ['bank', 'atm', 'money-exchange'] },
  {
    slug: 'leisure',
    subSlugs: ['beach', 'park', 'cinema', 'gym', 'tourist-attr'],
  },
  { slug: 'faith', subSlugs: ['mosque', 'church'] },
  {
    slug: 'auto',
    subSlugs: ['gas-station', 'car-wash', 'auto-repair', 'car-rental', 'parking'],
  },
  // Other is built dynamically by [otherSubs] — its subSlugs here is
  // intentionally empty, the bucket builder special-cases it.
  { slug: 'other', subSlugs: [] },
]);

/// All sub-slugs claimed by a curated main. Used to decide whether a
/// place's `source_categories` justify Other-residency (none overlap).
const ALL_KNOWN_SUB_SLUGS = new Set(
  MAIN_CATEGORIES.flatMap((m) => m.subSlugs)
);

/// Cross-category attribute surfacing — INTENTIONALLY EMPTY.
///
/// Previously this injected places into buckets they didn't natively
/// belong to (e.g. supermarkets-with-ATMs into the Bank bucket via
/// has_atm). The intent was for the mobile UI to render a "Has ATM"
/// chip so users understood why a supermarket was in the Bank tab.
///
/// In practice the chip wasn't visually distinctive enough, so users
/// saw supermarkets in the Banks tab as straight-up wrong data. We
/// chose strict membership: the Bank tab contains only real banks.
///
/// The underlying `attributes.has_atm` / `has_pharmacy` flags are
/// still computed and stored on each place document — the mobile
/// detail page can still render those as informational chips. They
/// just don't drive bucket membership anymore.
const ATTRIBUTE_SURFACING = Object.freeze({});

/// How many of the top `place.type` strings get their own named
/// sub-bucket inside the Other main. The rest fall to `misc`.
const OTHER_TOP_N_TYPES = 20;

/// Build the full catalogue from a list of places.
///
/// Returns:
///   {
///     generated_at: ISO timestamp,
///     total_places: int,
///     mains: {
///       <mainSlug>: {
///         place_count: int (unique place IDs across this main's subs),
///         subs: {
///           <subSlug>: {
///             label: string (for dynamic Other types),
///             place_count: int,
///             places: CompactPlace[],
///           },
///         },
///       },
///     },
///   }
export function buildCatalogue(places) {
  const out = {
    generated_at: new Date().toISOString(),
    total_places: 0,
    mains: {},
  };

  // Initialize every main, including Other (subs filled below).
  for (const main of MAIN_CATEGORIES) {
    out.mains[main.slug] = {
      place_count: 0,
      subs: {},
    };
  }

  // Track unique place IDs per main so the count reflects "places in
  // this main" rather than "place-bucket memberships" (which would
  // double-count a place that's in two subs of the same main).
  const seenPerMain = Object.fromEntries(
    MAIN_CATEGORIES.map((m) => [m.slug, new Set()])
  );

  // ── Curated mains: identity + attribute surfacing ──────────────────
  for (const main of MAIN_CATEGORIES) {
    if (main.slug === 'other') continue;
    for (const sub of main.subSlugs) {
      const bucket = [];
      const attrKey = ATTRIBUTE_SURFACING[sub];
      for (const p of places) {
        if (!p?.place_id) continue;
        const inIdentity = Array.isArray(p.source_categories) &&
            p.source_categories.includes(sub);
        const inAttribute = !inIdentity &&
            attrKey != null &&
            p.attributes?.[attrKey] === true;
        if (!inIdentity && !inAttribute) continue;
        const cp = toCompactPlace(p, {
          surfacedVia: inIdentity ? 'identity' : 'attribute',
        });
        if (cp == null) continue;
        bucket.push(cp);
        seenPerMain[main.slug].add(p.place_id);
      }
      // Server-side default sort: best-first by sort_score desc, with
      // null sort_scores at the bottom. Mobile re-sorts client-side
      // per the user's SortMode; this is just the static order.
      bucket.sort((a, b) =>
          (b.sort_score ?? -Infinity) - (a.sort_score ?? -Infinity));
      out.mains[main.slug].subs[sub] = {
        label: null, // null = mobile uses its static label for the slug
        place_count: bucket.length,
        places: bucket,
      };
    }
    out.mains[main.slug].place_count = seenPerMain[main.slug].size;
  }

  // ── Other main: dynamic by place.type ──────────────────────────────
  // 1. Collect every place that didn't make it into a curated main.
  const otherPlaces = places.filter((p) => {
    if (!p?.source_categories) return true;
    return p.source_categories.every((s) => !ALL_KNOWN_SUB_SLUGS.has(s));
  });

  // 2. Group by lowercase `place.type`, tracking counts and per-bucket
  //    place lists. Places with no type land in the implicit
  //    `null`-type group which becomes part of `misc`.
  const byType = new Map(); // type → { count, places[] }
  for (const p of otherPlaces) {
    if (!p?.place_id) continue;
    const t = (p.type ?? '').toLowerCase().trim();
    if (!byType.has(t)) byType.set(t, { count: 0, places: [] });
    const entry = byType.get(t);
    entry.count += 1;
    const cp = toCompactPlace(p, { surfacedVia: 'identity' });
    if (cp != null) entry.places.push(cp);
  }

  // 3. Rank types by count desc, alphabetical tiebreak (stable order).
  //    Top N become named subs (`type:<lowercase type>` slugs); the
  //    rest plus the empty-type group merge into `misc`.
  const ranked = [...byType.entries()]
      .filter(([t]) => t.length > 0)
      .sort((a, b) => {
        const byCount = b[1].count - a[1].count;
        return byCount !== 0 ? byCount : a[0].localeCompare(b[0]);
      });
  const kept = ranked.slice(0, OTHER_TOP_N_TYPES);
  const keptTypes = new Set(kept.map(([t]) => t));

  const otherSubs = out.mains.other.subs;
  for (const [type, entry] of kept) {
    const subSlug = `type_${slugifyType(type)}`;
    entry.places.sort((a, b) =>
        (b.sort_score ?? -Infinity) - (a.sort_score ?? -Infinity));
    otherSubs[subSlug] = {
      // Stash the raw type as the label so the mobile renders the
      // exact Google string ("Beauty salon", "Certified public
      // accountant", …) — same UX the legacy client-side dynamic
      // subs produced.
      label: capitalize(type),
      raw_type: type,
      place_count: entry.count,
      places: entry.places,
    };
  }

  // 4. Misc bucket: rest of named types + empty-type group + remainder.
  const miscPlaces = [];
  for (const p of otherPlaces) {
    if (!p?.place_id) continue;
    const t = (p.type ?? '').toLowerCase().trim();
    if (t.length > 0 && keptTypes.has(t)) continue; // already named
    const cp = toCompactPlace(p, { surfacedVia: 'identity' });
    if (cp != null) miscPlaces.push(cp);
  }
  miscPlaces.sort((a, b) =>
      (b.sort_score ?? -Infinity) - (a.sort_score ?? -Infinity));
  if (miscPlaces.length > 0) {
    otherSubs.misc = {
      label: 'Other',
      raw_type: null,
      place_count: miscPlaces.length,
      places: miscPlaces,
    };
  }

  out.mains.other.place_count = otherPlaces.length;
  out.total_places = places.length;
  return out;
}

/// Build the small `catalogue_meta/index` summary doc from a full
/// catalogue. Same shape per main / sub but without the place arrays
/// — just labels + counts so the mobile can render the home grid
/// and sub-cat grid without paying for the full place lists upfront.
export function buildCatalogueIndex(catalogue) {
  const mains = {};
  for (const [mainSlug, main] of Object.entries(catalogue.mains)) {
    const subs = [];
    for (const [subSlug, sub] of Object.entries(main.subs)) {
      subs.push({
        sub: subSlug,
        label: sub.label,
        raw_type: sub.raw_type ?? null,
        place_count: sub.place_count,
      });
    }
    // Order: count desc, slug asc — stable across builds.
    subs.sort((a, b) =>
        b.place_count - a.place_count || a.sub.localeCompare(b.sub));
    mains[mainSlug] = {
      place_count: main.place_count,
      subs,
    };
  }
  return {
    generated_at: catalogue.generated_at,
    version: 1,
    total_places: catalogue.total_places,
    mains,
  };
}

// ── helpers ────────────────────────────────────────────────────────

/// Map a free-form Google type like "Beauty salon" to a Firestore-safe
/// slug suffix like `beauty_salon`. Keeps lowercase, replaces runs of
/// non-alnum with `_`, collapses duplicates, trims `_` edges. Avoids
/// the `:` colon the mobile-side legacy code used because Firestore
/// document IDs allow `:` but the `__` join in the doc path doesn't.
function slugifyType(type) {
  return type
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_{2,}/g, '_');
}

function capitalize(s) {
  if (!s) return '';
  return s[0].toUpperCase() + s.substring(1);
}
