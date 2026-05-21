// Maps URL → place_id resolver.
//
// Users paste a URL in the mobile app; this module parses it into a
// canonical place_id we can match against `places/` in Firestore.
//
// Supports both Google Maps and Apple Maps share formats:
//
//   1. Google short:  https://maps.app.goo.gl/<token>
//      → Resolve via HTTP follow-redirect to the long form, then reparse.
//
//   2. Google long form with CID hex pair (the most common share format):
//      https://www.google.com/maps/place/<Name>/@<lat>,<lng>,<zoom>z/
//        data=!4m...!1s0x14f99c7168c84899:0x5fd1f5b2c2e0edf6!8m2!3d<lat>!4d<lng>!16s%2Fg%2F<g_id>
//      → Extract the hex pair after `!1s` AND the decimal coords
//        after `!8m2!3d<lat>!4d<lng>`.
//
//   3. Google numeric CID query: https://maps.google.com/?cid=<decimal>
//      → Decimal CID. Convert to hex pair: low 64 bits of CID maps
//        to the second half of the hex pair; we can't reconstruct
//        the first half without a network lookup. So we treat this
//        as a "needs scraping" form (Playwright resolution).
//
//   4. Google search query only:  https://www.google.com/maps?q=...
//      → No specific place identifier; reject with a friendly error.
//
//   5. Apple Maps long form:
//      https://maps.apple.com/place?place-id=IBC14CF7EA612C25C&name=Ataa+Hospital&coordinate=31.261636,32.285680&address=...
//      → Parse query params directly: place-id is Apple's internal id
//        (NOT cross-compatible with Google), but coordinate + name are
//        enough to (a) check our duplicates by geo, and (b) drive a
//        scrape against those coordinates.
//
//   6. Apple Maps short:  https://maps.apple/p/<token>  (or maps.apple.com/p/)
//      → Resolve via HTTP follow-redirect, then reparse.
//
// The resolver's job is to produce as much identifying data as it
// can WITHOUT making network calls. The caller (submission endpoint)
// decides whether the parsed identifiers are enough to look up the
// place in Firestore directly, or whether we need to fall through
// to a Playwright scrape against the place's coordinates.

/// Result of parsing a Google Maps URL.
///
///   - kind: which URL form matched (informational; used for logging).
///   - place_hex_pair: e.g. "0x14f99c7168c84899:0x5fd1f5b2c2e0edf6"
///                    when present. Lets us cross-reference to
///                    `places/` whose Google place_id field stores
///                    the ChIJ form OR raw hex (depends on scraper).
///   - lat / lon: decimal coordinates from the URL when present.
///   - is_short_url: true for maps.app.goo.gl; caller should expand
///                   before doing anything else.
///   - rejection: when non-null, the URL is unusable; the message is
///                a user-facing one-liner the mobile can surface.
export function parseGoogleMapsUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { rejection: 'Empty URL. Paste a map link.' };
  }
  // Sanitise zero-width + RTL marks + BOM before the URL parse. iOS
  // clipboards (and some chat apps) frequently embed invisibles when
  // copying — particularly U+200E/U+200F directional marks around
  // URLs in Arabic-locale UI text — that survive String#trim() but
  // make `new URL(input)` throw.
  const cleaned = input
      // U+200B–U+200F: zero-width space, ZWNJ, ZWJ, LRM, RLM
      // U+202A–U+202E: directional formatting (LRE/RLE/PDF/LRO/RLO)
      // U+2066–U+2069: directional isolates
      // U+FEFF:        BOM / zero-width no-break space
      .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
      .trim();
  let url;
  try {
    url = new URL(cleaned);
  } catch {
    return { rejection: 'That doesn\'t look like a URL.' };
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const isGoogle =
    host === 'maps.google.com' ||
    host === 'www.google.com' ||
    host === 'google.com' ||
    host === 'maps.app.goo.gl';
  const isApple =
    host === 'maps.apple.com' ||
    host === 'maps.apple' ||
    host === 'beta.maps.apple.com';
  if (!isGoogle && !isApple) {
    return {
      rejection:
        'That URL isn\'t a Google or Apple Maps link. Paste a maps.google.com / maps.app.goo.gl / maps.apple.com link.',
    };
  }
  if (host === 'maps.app.goo.gl') {
    return {
      kind: 'short',
      is_short_url: true,
      short_url: url.toString(),
    };
  }
  // Apple short links — same redirect-follow pattern as Google's short
  // links. Apple uses both maps.apple.com/p/<token> and the bare
  // maps.apple/p/<token> form (the latter is used in some shares).
  if (isApple && /^\/p\//.test(path)) {
    return {
      kind: 'short',
      is_short_url: true,
      short_url: url.toString(),
    };
  }
  // Apple long form — /place?place-id=...&name=...&coordinate=lat,lon
  // We treat Apple URLs separately from Google because:
  //   - place-id values are Apple-internal (no Google cross-reference).
  //   - Coordinates and the name come straight from the query string,
  //     no path decoding tricks needed.
  if (isApple) {
    return parseAppleMapsUrl(url);
  }
  // (4 removed) — the old "reject /maps?q=..." path was too aggressive.
  // The new permissive matcher below treats `q=lat,lon` as coords (a
  // real place pointer) and `q=text` as a search-name hint (passed to
  // admin review). The dedicated rejection at the end of this function
  // still catches the genuinely-empty case.
  // 3. Numeric CID — /maps?cid=<decimal>
  if (url.searchParams.has('cid')) {
    const cid = url.searchParams.get('cid');
    if (/^\d+$/.test(cid)) {
      // Convert decimal → hex (lower-cased, no 0x). We can't get the
      // ftid (first half of the hex pair) from a CID alone — that
      // requires a network lookup. Caller should fall back to
      // Playwright resolution against this CID.
      const hex = BigInt(cid).toString(16);
      return {
        kind: 'cid_only',
        cid_decimal: cid,
        cid_hex: hex,
        canonical_url: `https://maps.google.com/?cid=${cid}`,
      };
    }
  }
  // 2. Long form — extract whatever signal we can from any URL with
  //    `/maps`-style path. The previous version only accepted
  //    /maps/place/ and /maps/dir/, and rejected anything that even
  //    LOOKED like Maps but used a different path shape (e.g. iOS
  //    occasionally produces /maps/@lat,lon URLs after a share). With
  //    the more permissive shape below + the new admin-review path
  //    in the submit handler, the user gets their submission
  //    accepted instead of a hard rejection.
  const isMapsPath =
      path.startsWith('/maps/place/') ||
      path.startsWith('/maps/dir/') ||
      path.startsWith('/maps/@') ||
      path === '/maps' ||
      path === '/maps/' ||
      path.startsWith('/maps?') ||
      // Match anything under /maps/* that isn't already a special
      // shape we've handled.
      /^\/maps(\/|$)/.test(path);
  if (isMapsPath) {
    const data = url.searchParams.get('data') || '';
    const segments = path + (data ? '?data=' + data : '');
    const hexPairMatch = segments.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    const coordsMatch = segments.match(/!3d(-?[0-9.]+)!4d(-?[0-9.]+)/);
    const atMatch = path.match(/@(-?[0-9.]+),(-?[0-9.]+)/);
    // ll= and q=lat,lon are alternate coord encodings some share URLs
    // produce. Try them as last-resort signal.
    const llParam = url.searchParams.get('ll');
    const qParam = url.searchParams.get('q');
    let lat = null;
    let lon = null;
    if (coordsMatch) {
      lat = parseFloat(coordsMatch[1]);
      lon = parseFloat(coordsMatch[2]);
    } else if (atMatch) {
      lat = parseFloat(atMatch[1]);
      lon = parseFloat(atMatch[2]);
    } else if (llParam && llParam.includes(',')) {
      const [la, lo] = llParam.split(',', 2).map(parseFloat);
      if (Number.isFinite(la) && Number.isFinite(lo)) { lat = la; lon = lo; }
    } else if (qParam && /^-?[0-9.]+,-?[0-9.]+$/.test(qParam)) {
      const [la, lo] = qParam.split(',', 2).map(parseFloat);
      if (Number.isFinite(la) && Number.isFinite(lo)) { lat = la; lon = lo; }
    }
    if (!hexPairMatch && lat == null && !extractNameHint(path)) {
      // Last-ditch: a /maps?q=Some+Place URL. Reject only when there's
      // truly nothing actionable (no hex, no coords, no place-name
      // segment, and no q= text).
      const qTextMatch = qParam && !/^-?[0-9.]+,-?[0-9.]+$/.test(qParam)
          ? qParam : null;
      if (!qTextMatch) {
        return {
          rejection:
              'That link doesn\'t name a specific place. Open the place on Google Maps, tap Share, then paste here.',
        };
      }
      // We at least have a text query. Pass to admin review.
      return {
        kind: 'long_form',
        place_hex_pair: null,
        lat: null,
        lon: null,
        name_hint: decodeURIComponent(qTextMatch).replace(/\+/g, ' '),
      };
    }
    return {
      kind: 'long_form',
      place_hex_pair: hexPairMatch ? hexPairMatch[1].toLowerCase() : null,
      lat,
      lon,
      // Extract the canonical name from the path (the segment between
      // /maps/place/ and the next /). Used for display + admin review.
      name_hint: extractNameHint(path),
    };
  }
  return {
    rejection:
      'That link doesn\'t look like a Google Maps place link. Open the place on Google Maps, tap Share → Copy, then paste here.',
  };
}

/// Apple Maps URL parser. Reads place-id, name, address, coordinate
/// query params. Apple's place-id is a base64-like token and isn't
/// cross-compatible with Google's place_id — we keep it under
/// `apple_place_id` so the caller knows to use coordinates for
/// matching against Google-scraped entries.
function parseAppleMapsUrl(url) {
  const q = url.searchParams;
  const applePlaceId = q.get('place-id') || null;
  const name = q.get('name')
      ? decodeURIComponent(q.get('name')).replace(/\+/g, ' ')
      : null;
  const address = q.get('address')
      ? decodeURIComponent(q.get('address')).replace(/\+/g, ' ')
      : null;
  const coord = q.get('coordinate');
  let lat = null;
  let lon = null;
  if (coord && coord.includes(',')) {
    const [latStr, lonStr] = coord.split(',', 2);
    const latN = parseFloat(latStr);
    const lonN = parseFloat(lonStr);
    if (Number.isFinite(latN) && Number.isFinite(lonN)) {
      lat = latN;
      lon = lonN;
    }
  }
  if (lat == null && !applePlaceId) {
    return {
      rejection:
        'Couldn\'t parse a place from that Apple Maps link. Try sharing the place from Maps again.',
    };
  }
  return {
    kind: 'apple_long',
    apple_place_id: applePlaceId,
    // Apple URLs don't carry the Google hex pair; leave it null so the
    // submission handler falls through to geo-proximity matching +
    // (eventually) a Playwright scrape.
    place_hex_pair: null,
    lat,
    lon,
    name_hint: name,
    address_hint: address,
  };
}

/// Pulls the place name out of `/maps/place/<Name>/...` and decodes
/// the URL-encoded form for display. Returns null when the path
/// doesn't have that structure.
function extractNameHint(path) {
  const m = path.match(/^\/maps\/place\/([^/]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/\+/g, ' ');
  } catch {
    return null;
  }
}

/// Expand a short URL to its canonical long form by walking up to
/// MAX_HOPS HTTP redirects. Returns the final URL string.
///
/// Some Google share links do A→B→C: the maps.app.goo.gl service
/// 302s to a maps.google.com URL that 301s to www.google.com/maps/...,
/// and a 1-hop expander loses the actual place data on the way. The
/// loop below follows each hop until we hit a non-3xx response OR
/// the hop count cap.
const MAX_REDIRECT_HOPS = 5;

export async function expandShortUrl(shortUrl) {
  let currentUrl = shortUrl;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    let res;
    try {
      // Use HEAD on the first hop. If the server is finicky (some
      // CDNs return Location only on GET), we fall through to GET on
      // a retry.
      res = await fetch(currentUrl, {
        method: hop === 0 ? 'HEAD' : 'GET',
        redirect: 'manual',
        headers: {
          // Mobile UA — maximises the chance of getting the long URL
          // rather than an "open in Maps app" interstitial.
          'User-Agent':
              'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
          // Some Google services 200 instead of 302 unless we set
          // Accept: text/html. Cheap belt-and-braces.
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
    } catch (e) {
      throw new Error(`short-url fetch failed at hop ${hop}: ${e.message}`);
    }
    const status = res.status;
    const location = res.headers.get('location');
    if (location) {
      // Resolve relative redirects against the current URL.
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        currentUrl = location;
      }
      // If the new URL is a recognisable long form already, we can
      // stop — Google sometimes 302s directly to the final destination.
      if (!/maps\.app\.goo\.gl|maps\.apple|app\/p\//.test(currentUrl)) {
        return currentUrl;
      }
      continue; // chained redirect — keep walking
    }
    // No redirect, but the URL itself may already be the long form
    // (e.g. when a HEAD returns 200 for an already-resolved URL).
    if (status >= 200 && status < 300) {
      return currentUrl;
    }
    throw new Error(`short-url did not redirect at hop ${hop} (status ${status})`);
  }
  // Hit the hop cap — return whatever the latest URL is so the parser
  // gets a shot at it instead of failing.
  return currentUrl;
}

/// Convenience wrapper: parse, follow short-URL redirects if needed,
/// reparse. Returns a fully-resolved parsed payload OR a rejection.
export async function resolveUrl(rawUrl) {
  let parsed = parseGoogleMapsUrl(rawUrl);
  if (parsed.rejection) return parsed;
  if (parsed.is_short_url) {
    let expanded;
    try {
      expanded = await expandShortUrl(parsed.short_url);
    } catch (e) {
      return {
        rejection: `Couldn't expand the short link: ${e.message}`,
      };
    }
    parsed = parseGoogleMapsUrl(expanded);
    if (parsed.rejection) return parsed;
  }
  return parsed;
}
