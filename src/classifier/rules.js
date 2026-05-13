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
  'Ferry service': 'bus-station',

  // ── Cuisine-specific restaurant types ──────────────────────────────
  // Google emits cuisine subtypes; all map to the general restaurant
  // slug since we don't (yet) want a chip per cuisine.
  'Vegetarian restaurant': 'restaurant',
  'Middle Eastern restaurant': 'restaurant',
  'American restaurant': 'restaurant',
  'Western restaurant': 'restaurant',
  'European restaurant': 'restaurant',
  'Syrian restaurant': 'restaurant',
  'Greek restaurant': 'restaurant',
  'Japanese restaurant': 'restaurant',
  'Sushi restaurant': 'restaurant',
  'Korean restaurant': 'restaurant',
  'Izakaya restaurant': 'restaurant',
  'Grill restaurant': 'restaurant',
  'BBQ restaurant': 'restaurant',
  'Koshari restaurant': 'fast-food',
  'Falafel shop': 'fast-food',
  'Steak house': 'restaurant',
  'مطعم مأكولات مشوية': 'restaurant',
  'مطعم كشري': 'fast-food',
  'مطعم فلافل': 'fast-food',
  'مطعم مأكولات بحرية': 'fish-seafood',

  // ── Coffee variants ────────────────────────────────────────────────
  'متجر القهوة': 'coffee',
  'محمصة قهوة': 'coffee',
  'كافتيريا': 'coffee',
  'مقهى للشيشة/الأرجيلة': 'coffee',
  'Coffee roastery': 'coffee',
  'Shisha cafe': 'coffee',

  // ── Hospital / clinic subtypes ─────────────────────────────────────
  'مستشفى الولادة': 'hospital',
  'مستشفى عام': 'hospital',
  'المركز الطبي العام': 'clinic',
  'مركز التصوير التشخيصي الطبي': 'clinic',
  'طبيب أمراض نسائية و توليد': 'clinic',
  'طبيب أمراض نسائية': 'clinic',
  'أخصائي أشعة': 'clinic',
  'مركز رعاية يومية للأطفال': 'clinic',

  // ── Hotel / hostel subtypes ────────────────────────────────────────
  'فندق منتجع': 'hotel',
  'بيت شباب': 'hostel',

  // ── Supermarket / grocery subtypes ─────────────────────────────────
  'Discount supermarket': 'supermarket',
  'متجر لبيع المكسرات': 'grocery',
  'متجر أغذية صحية': 'grocery',

  // ── Auto / transport subtypes ──────────────────────────────────────
  // `auto-parts` isn't a curated slug yet (would conflict with the
  // schema). Fold under auto-repair — closest semantic match; users
  // looking for auto-repair are likely happy to see parts stores too.
  'سوق قطع غيار السيارات': 'auto-repair',
  'متجر قطع غيار السيارات': 'auto-repair',
  'Auto parts store': 'auto-repair',
  'موقف سيارات': 'parking',
  'خدمة العناية الشاملة بالسيارة': 'auto-repair',
  'مغسلة سيارات ذاتية الخدمة': 'car-wash',
  // Transport service — fold under taxi (closest user-facing match).
  'خدمة وسائل النقل': 'taxi',
  'Transportation service': 'taxi',

  // ── Electronics / phone variants ───────────────────────────────────
  'متجر هواتف جوالة': 'electronics',
  'متجر هواتف': 'electronics',
  'Telecommunications service provider': 'electronics',

  // ── Veterinary variants ────────────────────────────────────────────
  'Veterinary pharmacy': 'veterinarian',
  'صيدلية بيطرية': 'veterinarian',

  // ── Arabic-language type returns ───────────────────────────────────
  // Google sometimes responds to Arabic queries (hl=ar) with the
  // place's type localised. Without these entries, large Egyptian-
  // Arabic batches all fall to the LLM tier or "other" — adding them
  // here is essentially free and pushes thousands of docs to the rules
  // fast-path instead of the slow path.
  'مقهى': 'coffee',
  'كافيه': 'coffee',
  'كافيتيريا': 'coffee',
  'مطعم': 'restaurant',
  'Barbecue restaurant': 'restaurant',
  'Breakfast restaurant': 'restaurant',
  'Buffet restaurant': 'restaurant',
  'Brunch restaurant': 'restaurant',
  'مطعم وجبات سريعة': 'fast-food',
  'بيتزا': 'fast-food',
  'Creperie': 'fast-food',
  'كريب': 'fast-food',
  'Crepe restaurant': 'fast-food',
  'Takeout restaurant': 'fast-food',
  'مطعم تيك أواي': 'fast-food',
  'مخبز': 'bakery',
  'حلواني': 'dessert',
  'مطعم حلويات': 'dessert',
  'فندق': 'hotel',
  'بيت ضيافة': 'hostel',
  'مبيت وإفطار': 'hostel',
  'صيدلية': 'pharmacy',
  'مستشفى': 'hospital',
  'مركز طبي': 'clinic',
  'مركز الصحة المجتمعية': 'clinic',
  'عيادة': 'clinic',
  'عيادة طبية': 'clinic',
  'طبيب اسنان': 'dentist',
  'طبيب أسنان': 'dentist',
  'عيادة أسنان': 'dentist',
  'سوبر ماركت': 'supermarket',
  'سوبرماركت': 'supermarket',
  'هايبر ماركت': 'supermarket',
  'هايبرماركت': 'supermarket',
  'بقالة': 'grocery',
  'مركز تسوق': 'mall',
  'متجر بقالة': 'grocery',
  'Natural goods store': 'grocery',
  'Convenience store': 'grocery',
  'محل ملابس': 'clothing',
  'متجر ملابس': 'clothing',
  'محل أحذية': 'shoe-store',
  'متجر أحذية': 'shoe-store',
  'محل موبايلات': 'electronics',
  'محل إلكترونيات': 'electronics',
  'محل هدايا': 'gift-shop',
  'محل ألعاب': 'toy-store',
  'مكتبة': 'bookstore',
  'محل ورد': 'florist',
  'محل مجوهرات': 'jewelry',
  'محل ذهب': 'jewelry',
  'بنك': 'bank',
  'مصرف': 'bank',
  'صراف آلي': 'atm',
  'ماكينة صراف آلي': 'atm',
  'محل صرافة': 'money-exchange',
  'محطة وقود': 'gas-station',
  'محطة بنزين': 'gas-station',
  'مغسلة سيارات': 'car-wash',
  'ورشة سيارات': 'auto-repair',
  'ميكانيكي سيارات': 'auto-repair',
  'مرآب': 'parking',
  'مسجد': 'mosque',
  'كنيسة': 'church',
  'كاتدرائية': 'church',
  'شاطئ': 'beach',
  'حديقة': 'park',
  'منتزه': 'park',
  'سينما': 'cinema',
  'صالة ألعاب رياضية': 'gym',
  'نادي رياضي': 'gym',
  'متحف': 'tourist-attr',
  'معلم سياحي': 'tourist-attr',
  'مدرسة': 'school',
  'جامعة': 'university',
  'كلية': 'university',
  'مكتبة عامة': 'library',
  'مركز شرطة': 'police',
  'قسم شرطة': 'police',
  'مكتب بريد': 'post-office',
  'موقف تاكسي': 'taxi',
  'محطة حافلات': 'bus-station',
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
