// Image proxy. Google's `lh3.googleusercontent.com` and `ggpht.com` CDNs
// throttle direct requests from unknown origins (browsers from `localhost`,
// mobile apps, etc.) and frequently return HTTP 429. SerpApi works around
// this by proxying images through their own CDN. We do the same:
//
//   GET /img?u=<encoded-google-url>
//
// The server fetches the image server-to-server (no referer, browser UA),
// streams the bytes back to the caller, and caches the response on disk
// keyed by SHA-1 of the URL so repeated requests are instant.

import { request as httpsRequest } from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';

const CACHE_DIR = new URL('../../data/img-cache/', import.meta.url).pathname;
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000; // 1 week — image URLs are stable
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;  // 20 MB safety cap

const ALLOWED_HOST_SUFFIXES = [
  'googleusercontent.com',
  'ggpht.com',
  'google.com',
];

function hostAllowed(urlStr) {
  try {
    const host = new URL(urlStr).host;
    return ALLOWED_HOST_SUFFIXES.some((suf) => host === suf || host.endsWith(`.${suf}`));
  } catch {
    return false;
  }
}

function cachePathFor(url) {
  const key = createHash('sha1').update(url).digest('hex');
  return `${CACHE_DIR}${key}`;
}

// Streams the cached file to res with the right Content-Type. The cached file
// is `<sha>` (bytes) with a sidecar `<sha>.ct` for the content type.
async function streamCached(cachePath, res) {
  let ct = 'image/jpeg';
  try {
    ct = (await readFile(`${cachePath}.ct`, 'utf8')).trim() || ct;
  } catch {
    /* fall through */
  }
  res.set('Content-Type', ct);
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.set('X-Proxy-Source', 'disk');
  createReadStream(cachePath).pipe(res);
}

export async function imgProxyHandler(req, res) {
  const url = req.query.u;
  if (typeof url !== 'string' || !url) {
    return res.status(400).json({ error: 'u query parameter required' });
  }
  if (!/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: 'url must start with http(s)' });
  }
  if (!hostAllowed(url)) {
    return res.status(403).json({ error: 'host not in allow-list' });
  }

  const cachePath = cachePathFor(url);

  // Disk cache hit (within TTL).
  if (existsSync(cachePath)) {
    const age = Date.now() - statSync(cachePath).mtimeMs;
    if (age < CACHE_TTL_MS) return streamCached(cachePath, res);
  }

  // Fetch upstream. Mimic a real browser — Google's CDN gates on UA and
  // sec-fetch headers more than referrer.
  const upstream = await new Promise((resolve, reject) => {
    const reqOpts = {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'accept-encoding': 'identity',
        'accept-language': 'en-US,en;q=0.9',
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site',
      },
    };
    const upReq = httpsRequest(url, reqOpts, resolve);
    upReq.on('error', reject);
    upReq.end();
  });

  if (upstream.statusCode !== 200) {
    upstream.resume(); // drain
    return res
      .status(upstream.statusCode || 502)
      .json({ error: 'upstream returned ' + upstream.statusCode });
  }

  const contentType = upstream.headers['content-type'] || 'image/jpeg';
  res.set('Content-Type', contentType);
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.set('X-Proxy-Source', 'fresh');

  // Tee the stream — write to client and accumulate for disk cache.
  const chunks = [];
  let total = 0;
  upstream.on('data', (chunk) => {
    total += chunk.length;
    if (total > MAX_IMAGE_BYTES) {
      // Image too large — stop teeing, just stream to client.
      chunks.length = 0;
    } else {
      chunks.push(chunk);
    }
    res.write(chunk);
  });
  upstream.on('end', async () => {
    res.end();
    if (chunks.length === 0) return;
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cachePath, Buffer.concat(chunks));
      await writeFile(`${cachePath}.ct`, contentType);
    } catch (e) {
      console.error('img-proxy cache write failed:', e.message);
    }
  });
  upstream.on('error', (e) => {
    if (!res.headersSent) res.status(502).json({ error: e.message });
    else res.destroy();
  });
}
