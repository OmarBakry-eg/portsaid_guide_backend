// Helper: given a sub-slug (e.g. 'coffee'), return the main slug that
// claims it ('food'). Mirror of the mobile's `mainCategoryFor` in
// `lib/core/util/category_catalog.dart`.

import { MAIN_CATEGORIES } from './bucket.js';

/// Returns the main category slug that contains [subSlug], or null
/// when no main claims it. The Other main intentionally returns null
/// here — its membership is dynamic (place.type-based) and not driven
/// by a static sub-slug list.
export function mainCategoryForSub(subSlug) {
  if (!subSlug) return null;
  for (const main of MAIN_CATEGORIES) {
    if (main.slug === 'other') continue;
    if (main.subSlugs.includes(subSlug)) return main.slug;
  }
  return null;
}
