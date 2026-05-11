// Single source of truth for env-configurable settings. Centralised so the
// parser and the HTTP server agree on URL shapes without hardcoded strings
// scattered everywhere.
//
// Override via environment variables, e.g.:
//   API_BASE_URL=https://api.portsaid.app  (production)
//   API_BASE_URL=http://localhost:8080     (dev, default)

export const API_BASE_URL =
  process.env.API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8080';

export const SERVER_PORT = parseInt(process.env.PORT ?? '8080', 10);

// Cache TTLs — how long a scrape result stays valid before we refetch on hit.
export const CACHE_TTL_MS = {
  place: 6 * 3600 * 1000,    // place details refresh every 6h
  reviews: 1 * 3600 * 1000,  // reviews can change hourly (new reviews come in)
  photos: 6 * 3600 * 1000,   // photos churn slowly
};

// Build the SerpApi-shaped helper URLs but pointing at our own server.
export function buildReviewsLink(dataId, hl = 'en') {
  return `${API_BASE_URL}/reviews?data_id=${encodeURIComponent(dataId)}&hl=${hl}`;
}

export function buildPhotosLink(dataId, hl = 'en') {
  return `${API_BASE_URL}/photos?data_id=${encodeURIComponent(dataId)}&hl=${hl}`;
}

export function buildPlaceLink(placeId, hl = 'en') {
  return `${API_BASE_URL}/place?place_id=${encodeURIComponent(placeId)}&hl=${hl}`;
}

// Image-URL strategy.
//
// We DEFAULT to RAW Google CDN URLs in stored output (Firestore + places.json).
// That way the URLs are portable — Flutter, browsers, or any other client
// can fetch them directly from googleusercontent.com without depending on
// our proxy server being reachable on a specific host/port.
//
// Set `PROXY_IMAGE_URLS=1` to opt into the legacy behaviour of wrapping each
// Google URL with `${API_BASE_URL}/img?u=...`. That's only useful when:
//   - you're running the /img proxy on a public hostname (e.g. Cloud Run), AND
//   - you specifically need server-side caching / CDN-bypass for 429s.
const PROXY_IMAGES = process.env.PROXY_IMAGE_URLS === '1';

export function proxyImage(url) {
  if (typeof url !== 'string' || !url) return url;
  if (!PROXY_IMAGES) return url;
  // Only proxy Google CDN URLs — leave other URLs (Facebook, Instagram) alone.
  if (!/googleusercontent\.com|ggpht\.com|google\.com/.test(url)) return url;
  return `${API_BASE_URL}/img?u=${encodeURIComponent(url)}`;
}

// ── URL-mutation helpers used by the server middleware + scrub script ──

// Match any `http(s)://.../img?u=<encoded-google-url>` segment.
const PROXY_URL_PATTERN = /https?:\/\/[^"'\s/]+\/img\?u=/g;

// Used by the express middleware: stored URLs may carry a stale base URL;
// rewrite them so all responses use the CURRENT API_BASE_URL.
export function rewriteProxyUrls(obj) {
  if (obj == null) return obj;
  if (typeof obj === 'string') {
    return obj.replace(PROXY_URL_PATTERN, `${API_BASE_URL}/img?u=`);
  }
  if (Array.isArray(obj)) return obj.map(rewriteProxyUrls);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = rewriteProxyUrls(obj[k]);
    return out;
  }
  return obj;
}

// Strip the proxy entirely, returning the raw Google URL that was wrapped.
// Used by `scrub-firestore.js` to clean URLs left over from when we still
// stored proxy-wrapped values.
const SINGLE_PROXY_RE =
  /https?:\/\/[^"'\s/]+\/img\?u=([^"'\s&]+)/g;

export function stripProxyUrls(obj) {
  if (obj == null) return obj;
  if (typeof obj === 'string') {
    return obj.replace(SINGLE_PROXY_RE, (_, encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch (_) {
        return encoded;
      }
    });
  }
  if (Array.isArray(obj)) return obj.map(stripProxyUrls);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = stripProxyUrls(obj[k]);
    return out;
  }
  return obj;
}
