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

// Image proxy URL. Set RAW_IMAGE_URLS=1 in env to disable proxying — useful
// for debugging or when you need direct CDN URLs in the output.
const PROXY_IMAGES = process.env.RAW_IMAGE_URLS !== '1';

export function proxyImage(url) {
  if (typeof url !== 'string' || !url) return url;
  if (!PROXY_IMAGES) return url;
  // Only proxy Google CDN URLs — leave other URLs (Facebook, Instagram) alone.
  if (!/googleusercontent\.com|ggpht\.com|google\.com/.test(url)) return url;
  return `${API_BASE_URL}/img?u=${encodeURIComponent(url)}`;
}

// Rewrite any `http(s)://.../img?u=...` URLs embedded in a stored response so
// they point to the CURRENT API_BASE_URL. This makes stored URLs portable —
// you can change API_BASE_URL between dev/prod without re-scraping.
const PROXY_URL_PATTERN = /https?:\/\/[^"'\s/]+\/img\?u=/g;
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
