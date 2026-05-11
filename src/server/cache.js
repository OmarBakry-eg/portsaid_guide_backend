// File-based cache. Each (kind × key) pair gets one JSON file under
// `data/cache/<kind>/<key>.json`. Cheap, durable across restarts, and works
// without any external service. Swap for Redis later if needed.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = new URL('../../data/cache/', import.meta.url).pathname;

function keyOf(s) {
  // Safe filename: hash long/odd inputs but keep the prefix readable.
  if (/^[a-zA-Z0-9_:.-]{1,80}$/.test(s)) return s.replace(/[:]/g, '_');
  return createHash('sha1').update(s).digest('hex');
}

export async function getCached(kind, rawKey, ttlMs) {
  const path = `${ROOT}${kind}/${keyOf(rawKey)}.json`;
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf8');
    const { savedAt, data } = JSON.parse(raw);
    if (Date.now() - savedAt > ttlMs) return null;
    return { data, age_ms: Date.now() - savedAt };
  } catch {
    return null;
  }
}

export async function setCached(kind, rawKey, data) {
  const path = `${ROOT}${kind}/${keyOf(rawKey)}.json`;
  await mkdir(`${ROOT}${kind}`, { recursive: true });
  await writeFile(path, JSON.stringify({ savedAt: Date.now(), data }));
}
