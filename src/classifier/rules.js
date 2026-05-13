// Deterministic classification rules — the fast path that handles the
// 70-80% of places where Google's `type` field is unambiguous.
//
// Two maps:
//   1. GOOGLE_TYPE_TO_SLUG — exact match on `place.type` / `place.types[]`
//      values that Google emits. Strong signal, high confidence.
//   2. NAME_KEYWORD_TO_SLUG — substring match on the place title (English
//      + Arabic). Used by the heuristics layer when the Google type is
//      missing or too generic. Lower confidence than type matches.
//
// Adding entries here is the cheapest way to make the pipeline smarter
// without touching the LLM at all.

/// Canonical Google Maps type → our slug. Values are the exact strings
/// Google emits in `place.type` / `place.types[]` arrays. Casing matters
/// — Google capitalises consistently. Comparison is done case-insensitive
/// by the caller, but keys here mirror the canonical form for readability.
export const GOOGLE_TYPE_TO_SLUG = Object.freeze({
  // ── Food & drink ───────────────────────────────────────────────────
  'Cafe': 'coffee',
  'Café': 'coffee',
  'Coffee shop': 'coffee',
  'Coffeehouse': 'coffee',
  'Espresso bar': 'coffee',

  'Restaurant': 'restaurant',
  'Family restaurant': 'restaurant',
  'Egyptian restaurant': 'restaurant',
  'Mediterranean restaurant': 'restaurant',
  'Lebanese restaurant': 'restaurant',
  'Turkish restaurant': 'restaurant',
  'Italian restaurant': 'restaurant',
  'Asian restaurant': 'restaurant',
  'Chinese restaurant': 'restaurant',
  'Indian restaurant': 'restaurant',

  'Seafood restaurant': 'fish-seafood',
  'Fish restaurant': 'fish-seafood',

  'Fast food restaurant': 'fast-food',
  'Hamburger restaurant': 'fast-food',
  'Pizza restaurant': 'fast-food',
  'Sandwich shop': 'fast-food',
  'Chicken restaurant': 'fast-food',
  'Kebab shop': 'fast-food',
  'Shawarma restaurant': 'fast-food',

  'Bakery': 'bakery',
  'Patisserie': 'bakery',
  'Pastry shop': 'bakery',

  'Dessert shop': 'dessert',
  'Ice cream shop': 'dessert',
  'Frozen yogurt shop': 'dessert',

  // ── Lodging ────────────────────────────────────────────────────────
  'Hotel': 'hotel',
  'Resort hotel': 'hotel',
  'Inn': 'hotel',
  'Lodging': 'hotel',
  'Hostel': 'hostel',
  'Youth hostel': 'hostel',

  // ── Health ─────────────────────────────────────────────────────────
  'Pharmacy': 'pharmacy',
  'Drug store': 'pharmacy',

  'Hospital': 'hospital',
  'General hospital': 'hospital',
  'Medical center': 'hospital',

  'Medical clinic': 'clinic',
  'Clinic': 'clinic',
  'Doctor': 'clinic',
  'Health consultant': 'clinic',

  'Dentist': 'dentist',
  'Dental clinic': 'dentist',

  'Veterinarian': 'veterinarian',
  'Veterinary care': 'veterinarian',
  'Animal hospital': 'veterinarian',

  // ── Shopping (general) ─────────────────────────────────────────────
  'Supermarket': 'supermarket',
  'Hypermarket': 'supermarket',

  'Grocery store': 'grocery',
  'Convenience store': 'grocery',

  'Shopping mall': 'mall',
  'Shopping center': 'mall',

  // ── Shopping (clothing) ────────────────────────────────────────────
  'Clothing store': 'clothing',
  'Boutique': 'clothing',

  'Men\'s clothing store': 'clothing-men',
  'Men clothing store': 'clothing-men',

  'Women\'s clothing store': 'clothing-women',
  'Women clothing store': 'clothing-women',
  'Lingerie store': 'clothing-women',

  'Children\'s clothing store': 'clothing-kids',
  'Kids clothing store': 'clothing-kids',
  'Baby clothing store': 'clothing-kids',

  'Shoe store': 'shoe-store',
  'Sportswear store': 'shoe-store',

  // ── Shopping (electronics & tech) ──────────────────────────────────
  'Electronics store': 'electronics',
  'Computer store': 'electronics',
  'Cell phone store': 'electronics',
  'Mobile phone shop': 'electronics',

  // ── Shopping (specialty) ───────────────────────────────────────────
  'Candy store': 'candy-store',
  'Sweet shop': 'candy-store',
  'Confectionery': 'candy-store',
  'Chocolate shop': 'candy-store',

  'Gift shop': 'gift-shop',
  'Souvenir store': 'gift-shop',

  'Toy store': 'toy-store',
  'Game store': 'toy-store',

  'Book store': 'bookstore',
  'Bookstore': 'bookstore',

  'Florist': 'florist',
  'Flower shop': 'florist',

  'Jewelry store': 'jewelry',
  'Jeweler': 'jewelry',
  'Gold dealer': 'jewelry',
  'Watch store': 'jewelry',

  'Stationery store': 'stationery',
  'Office supply store': 'stationery',
  'Office supplies wholesaler': 'stationery',

  // ── Money ──────────────────────────────────────────────────────────
  'Bank': 'bank',
  'Commercial bank': 'bank',
  'Savings bank': 'bank',
  'Credit union': 'bank',
  'Financial institution': 'bank',

  'ATM': 'atm',
  'Automated teller machine': 'atm',

  'Foreign exchange office': 'money-exchange',
  'Currency exchange': 'money-exchange',
  'Money transfer service': 'money-exchange',

  // ── Auto ───────────────────────────────────────────────────────────
  'Gas station': 'gas-station',
  'Petrol station': 'gas-station',
  'Filling station': 'gas-station',

  'Car wash': 'car-wash',

  'Auto repair shop': 'auto-repair',
  'Mechanic': 'auto-repair',
  'Car repair and maintenance service': 'auto-repair',
  'Auto body shop': 'auto-repair',

  'Car rental agency': 'car-rental',

  'Parking lot': 'parking',
  'Parking garage': 'parking',

  // ── Worship ────────────────────────────────────────────────────────
  'Mosque': 'mosque',
  'Islamic mosque': 'mosque',

  'Church': 'church',
  'Coptic orthodox church': 'church',
  'Catholic church': 'church',
  'Cathedral': 'church',
  'Orthodox church': 'church',

  // ── Entertainment & recreation ─────────────────────────────────────
  'Beach': 'beach',
  'Public beach': 'beach',

  'Park': 'park',
  'Public park': 'park',
  'Garden': 'park',

  'Movie theater': 'cinema',
  'Cinema': 'cinema',

  'Gym': 'gym',
  'Fitness center': 'gym',
  'Health club': 'gym',

  'Tourist attraction': 'tourist-attr',
  'Historical landmark': 'tourist-attr',
  'Museum': 'tourist-attr',
  'Monument': 'tourist-attr',

  // ── Education ──────────────────────────────────────────────────────
  'School': 'school',
  'Primary school': 'school',
  'Elementary school': 'school',
  'High school': 'school',
  'Private school': 'school',
  'International school': 'school',

  'University': 'university',
  'College': 'university',
  'Higher education institution': 'university',

  'Library': 'library',
  'Public library': 'library',

  // ── Government ─────────────────────────────────────────────────────
  'Police station': 'police',
  'Police': 'police',

  'Post office': 'post-office',

  // ── Transport ──────────────────────────────────────────────────────
  'Taxi stand': 'taxi',
  'Taxi service': 'taxi',

  'Bus station': 'bus-station',
  'Bus stop': 'bus-station',
});

/// Generic Google types that we deliberately DON'T map to anything — they
/// signal nothing useful and should fall through to heuristics / LLM /
/// "other". Matching one of these in `type` means we keep walking the
/// pipeline rather than committing.
export const GENERIC_TYPES = new Set([
  'Establishment',
  'Point of interest',
  'Local business',
  'Store',           // too vague — could be anything; let heuristics decide
  'Place of worship', // ambiguous between mosque/church — let name resolve
  'Business',
]);

/// Substring → slug. Lowercased. Matched against the place title (English)
/// and `title_ar` / Arabic content of the title field. Used by the
/// heuristics layer when the Google type is missing or generic. "Café" in
/// the name is a stronger signal than the word "bank" because cafes are
/// almost always named "<X> Café" while "Bank" appears in many names that
/// aren't banks ("Information Bank Café", "Mobile Bank", etc.).
///
/// Order doesn't matter — the heuristics scorer counts hits per slug and
/// picks the strongest.
export const NAME_KEYWORD_TO_SLUG = Object.freeze({
  // English keywords — keep them specific enough that they don't
  // false-positive on common business names. "Bank" is intentionally
  // absent because it appears in lots of café / store names.
  'café': 'coffee', 'cafe': 'coffee', 'coffee shop': 'coffee',
  'restaurant': 'restaurant',
  'seafood': 'fish-seafood',
  'pizza': 'fast-food', 'burger': 'fast-food', 'kfc': 'fast-food',
  'mcdonald': 'fast-food', 'shawarma': 'fast-food', 'kebab': 'fast-food',
  'bakery': 'bakery', 'patisserie': 'bakery',
  'ice cream': 'dessert', 'gelato': 'dessert',
  'hotel': 'hotel', 'resort': 'hotel',
  'hostel': 'hostel',
  'pharmacy': 'pharmacy', 'pharmacie': 'pharmacy',
  'hospital': 'hospital',
  'clinic': 'clinic',
  'dental': 'dentist', 'dentist': 'dentist',
  'veterinary': 'veterinarian', 'vet clinic': 'veterinarian',
  'supermarket': 'supermarket', 'hypermarket': 'supermarket',
  'grocery': 'grocery',
  'mall': 'mall',
  'shoe store': 'shoe-store', 'shoes': 'shoe-store',
  'cell phone': 'electronics', 'mobile shop': 'electronics',
  'electronics': 'electronics',
  'candy': 'candy-store', 'sweets': 'candy-store',
  'gift shop': 'gift-shop',
  'toy store': 'toy-store',
  'bookstore': 'bookstore', 'book store': 'bookstore',
  'florist': 'florist', 'flowers': 'florist',
  'jewelry': 'jewelry', 'jeweler': 'jewelry',
  'stationery': 'stationery',
  'foreign exchange': 'money-exchange', 'money transfer': 'money-exchange',
  'gas station': 'gas-station', 'petrol': 'gas-station',
  'car wash': 'car-wash',
  'auto repair': 'auto-repair', 'mechanic': 'auto-repair',
  'mosque': 'mosque',
  'church': 'church', 'cathedral': 'church',
  'beach': 'beach',
  'park': 'park',
  'cinema': 'cinema',
  'gym': 'gym', 'fitness': 'gym',
  'museum': 'tourist-attr',
  'school': 'school',
  'university': 'university', 'college': 'university',
  'library': 'library',
  'police': 'police',
  'post office': 'post-office',

  // Arabic keywords — common single-word indicators in Egyptian-Arabic
  // place names. These are usually decisive when present.
  'كافيه': 'coffee', 'قهوة': 'coffee',
  'مطعم': 'restaurant',
  'اسماك': 'fish-seafood', 'أسماك': 'fish-seafood',
  'بيتزا': 'fast-food', 'برجر': 'fast-food', 'شاورما': 'fast-food',
  'مخبز': 'bakery', 'فرن': 'bakery',
  'حلوى': 'candy-store', 'حلويات': 'dessert',
  'فندق': 'hotel',
  'صيدلية': 'pharmacy',
  'مستشفى': 'hospital',
  'عيادة': 'clinic',
  'طبيب اسنان': 'dentist', 'طبيب أسنان': 'dentist',
  'سوبر ماركت': 'supermarket', 'هايبر': 'supermarket',
  'بقالة': 'grocery',
  'مول': 'mall',
  'ملابس': 'clothing',
  'احذية': 'shoe-store', 'أحذية': 'shoe-store',
  'موبايل': 'electronics', 'موبايلات': 'electronics',
  'هدايا': 'gift-shop',
  'العاب': 'toy-store', 'ألعاب': 'toy-store',
  'مكتبة': 'bookstore',
  'ورد': 'florist',
  'مجوهرات': 'jewelry', 'ذهب': 'jewelry',
  'بنك': 'bank', 'مصرف': 'bank',
  'صراف': 'atm',
  'صرافة': 'money-exchange',
  'محطة بنزين': 'gas-station',
  'غسيل سيارات': 'car-wash',
  'ميكانيكي': 'auto-repair',
  'مسجد': 'mosque',
  'كنيسة': 'church',
  'شاطئ': 'beach',
  'حديقة': 'park',
  'سينما': 'cinema',
  'جيم': 'gym',
  'متحف': 'tourist-attr',
  'مدرسة': 'school',
  'جامعة': 'university',
  'شرطة': 'police',
  'بريد': 'post-office',
});

/// Attribute detection rules — substring matches in `type` / `types[]` /
/// `extensions` / `title` that flip a boolean attribute true. Conservative
/// by design: a real bank wouldn't flip `has_atm` (its type is "Bank" or
/// "ATM" which goes via the primary slug). This only fires on cross-
/// category signals — "Has ATM" feature listed under a supermarket, an
/// ATM mentioned in the supermarket's name, etc.
export const ATTRIBUTE_SIGNALS = Object.freeze({
  has_atm: {
    type_substrings: ['atm'],
    name_substrings: ['atm', 'صراف'],
    extension_substrings: ['atm', 'cash machine'],
  },
  has_pharmacy: {
    type_substrings: ['pharmacy'],
    name_substrings: ['pharmacy', 'pharmacie', 'صيدلية'],
    extension_substrings: ['pharmacy'],
  },
  has_wifi: {
    type_substrings: [],
    name_substrings: [],
    extension_substrings: ['wi-fi', 'wifi', 'free wi-fi'],
  },
  has_parking: {
    type_substrings: [],
    name_substrings: [],
    extension_substrings: ['parking', 'free parking', 'valet parking'],
  },
  accepts_credit_cards: {
    type_substrings: [],
    name_substrings: [],
    extension_substrings: ['credit card', 'cards accepted', 'visa', 'mastercard'],
  },
});
