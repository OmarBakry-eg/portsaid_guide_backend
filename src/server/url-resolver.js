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
    return { rejection: 'Empty URL. Paste a Google Maps link.' };
  }
  let url;
  try {
    url = new URL(input.trim());
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
  // 4. Search query only — reject early. /maps?q=... is a "search the
  // map" URL, not a specific place.
  if ((path === '/maps' || path === '/maps/') && url.searchParams.has('q')) {
    return {
      rejection:
        'That link is a search query, not a specific place. Open the place on Google Maps, tap Share, then paste here.',
    };
  }
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
  // 2. Long form — extract hex pair + decimal coords from data= segment.
  if (path.startsWith('/maps/place/') || path.startsWith('/maps/dir/')) {
    const data = url.searchParams.get('data') || '';
    const segments = path + (data ? '?data=' + data : '');
    const hexPairMatch = segments.match(
      /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i
    );
    // Coords: `!8m2!3d<lat>!4d<lon>` or `!3d<lat>!4d<lon>` directly.
    const coordsMatch = segments.match(/!3d(-?[0-9.]+)!4d(-?[0-9.]+)/);
    // Alternate coords from the @lat,lon,zoom pattern in the path.
    const atMatch = path.match(/@(-?[0-9.]+),(-?[0-9.]+),[0-9.]+/);
    let lat = null;
    let lon = null;
    if (coordsMatch) {
      lat = parseFloat(coordsMatch[1]);
      lon = parseFloat(coordsMatch[2]);
    } else if (atMatch) {
      lat = parseFloat(atMatch[1]);
      lon = parseFloat(atMatch[2]);
    }
    if (!hexPairMatch && lat == null) {
      return {
        rejection:
          'Couldn\'t parse a place from that URL. Try sharing the place from Google Maps again.',
      };
    }
    return {
      kind: 'long_form',
      place_hex_pair: hexPairMatch ? hexPairMatch[1].toLowerCase() : null,
      lat: lat,
      lon: lon,
      // Extract the canonical name from the path (the segment between
      // /maps/place/ and the next /). Used for display + admin review.
      name_hint: extractNameHint(path),
    };
  }
  return {
    rejection:
      'Couldn\'t identify a place in that URL. Open the place on Google Maps and use the Share button.',
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

/// Expand a maps.app.goo.gl short URL to its canonical long form by
/// following the redirect. Returns the final URL string. Uses native
/// fetch with `redirect: 'manual'` so we get the Location header
/// even when the redirect would otherwise be opaque.
export async function expandShortUrl(shortUrl) {
  // Use HEAD first to be polite — Google's short-link service returns
  // the same Location header for HEAD as it does for GET.
  let res;
  try {
    res = await fetch(shortUrl, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        // Some Google services require a UA; mirror a common mobile
        // browser to maximise the chance of getting redirected to the
        // long URL rather than an "open in Maps app" interstitial.
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    });
  } catch (e) {
    throw new Error(`short-url fetch failed: ${e.message}`);
  }
  const location = res.headers.get('location');
  if (!location) {
    throw new Error(`short-url did not redirect (status ${res.status})`);
  }
  return location;
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
