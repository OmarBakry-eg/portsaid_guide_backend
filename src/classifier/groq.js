// Groq API client with 4-key rotation + JSON-mode classification.
//
// Why 4 keys?
//   - Groq's free tier on llama-3.1-8b-instant gives 14,400 RPD per key.
//   - We have four keys (GROQ1..GROQ4), giving us a 57,600 RPD ceiling.
//   - Far beyond our actual workload (~30 LLM calls per cron run + a
//     one-time ~500-call migration), but the rotation also handles
//     transient 429s gracefully.
//
// Rotation policy:
//   - Maintain a pool with a "cooldown until" timestamp per key.
//   - On every call, pick the first key whose cooldown has expired.
//   - On a 429 response from Groq, mark that key cooled-down for 60s and
//     try the next one.
//   - On a 5xx or network error, advance to the next key immediately
//     (the current key might be fine but we don't want to retry the
//     same upstream slot).
//   - When all four are cooled-down, throw `all_keys_exhausted`. The
//     caller falls back to deterministic heuristics.
//
// The pool is shared across the process lifetime — a single cron run
// gets to use stale cooldowns and warm up keys naturally.

import Groq from 'groq-sdk';
import {
  ATTRIBUTE_KEYS,
  EMPTY_ATTRIBUTES,
  FIT_VERDICTS,
  KNOWN_SLUGS,
  LLM_OUTPUT_SCHEMA,
} from './schema.js';

/// The Groq model we use for classification. `llama-3.1-8b-instant` is
/// purpose-built for low-latency structured-output workloads — far more
/// than enough capacity for "pick a slug + extract attributes" tasks.
const MODEL = 'llama-3.1-8b-instant';

/// How long to mark a key cooled-down when it returns 429.
const COOLDOWN_MS_ON_429 = 60_000;

/// Single source of truth for the keys. Reads env vars GROQ1..GROQ4 at
/// module init. Empty/missing keys are silently dropped — the pool just
/// has fewer slots.
function buildPool() {
  const env = process.env;
  const keys = ['GROQ1', 'GROQ2', 'GROQ3', 'GROQ4']
    .map((name) => ({ name, value: env[name] }))
    .filter((k) => k.value && k.value.length > 0);
  return keys.map((k) => ({
    name: k.name,
    client: new Groq({ apiKey: k.value }),
    cooledUntil: 0,
  }));
}

const POOL = buildPool();

/// True when we have at least one key. False when the env vars aren't
/// set (e.g. local dev without Groq) — the classifier index falls back
/// to heuristics entirely in that case.
export function llmIsAvailable() {
  return POOL.length > 0;
}

/// Round-robin cursor — biases us to spread load across keys when none
/// are cooled down. Not strictly necessary; nice-to-have for telemetry.
let cursor = 0;

function pickKey() {
  if (POOL.length === 0) return null;
  const now = Date.now();
  for (let i = 0; i < POOL.length; i++) {
    const idx = (cursor + i) % POOL.length;
    if (POOL[idx].cooledUntil <= now) {
      cursor = (idx + 1) % POOL.length;
      return POOL[idx];
    }
  }
  return null; // all cooled down
}

/// System + user prompt builder. The system prompt nails down the
/// classifier's job; the user prompt is just the place data. Kept short
/// to minimise token usage.
function buildMessages({ place, queriedSlug }) {
  const system = `You are classifying business listings from Google Maps for a Port Said city guide app.

Decision rules — apply in order:

1. PREFER the place's NAME and REVIEW TEXT over Google's type field. Google's type is often missing or generic ("Establishment"). A place named "<X> Café" is a coffee shop regardless of how Google typed it.
2. Pick a SINGLE primary_slug from the allowed list. Use "other" ONLY when no curated slug fits at all — not as a default.
3. For fit_for_queried_slug, answer how this place relates to the slug we scraped it under ("${queriedSlug ?? 'none'}"):
   - "strong": really IS a ${queriedSlug ?? 'X'}
   - "loose": adjacent / related, fine to keep
   - "feature_only": NOT a ${queriedSlug ?? 'X'} but CONTAINS a ${queriedSlug ?? 'X'} feature (mark the feature in attributes)
   - "unrelated": no connection
4. Set attribute booleans truthfully. has_atm = "this place has an ATM somewhere on premises". Don't set has_atm true on places that ARE banks/ATMs — that's redundant.
5. Confidence: 0.9+ for unambiguous, 0.6-0.8 for "probably right", below 0.5 for "guess".

Allowed primary_slug values:
${KNOWN_SLUGS.join(', ')}

Allowed fit_for_queried_slug values:
${FIT_VERDICTS.join(', ')}

Required attribute keys (all must be present, all booleans):
${ATTRIBUTE_KEYS.join(', ')}

Respond with VALID JSON matching this schema:
${JSON.stringify(LLM_OUTPUT_SCHEMA)}`;

  // Compress place data — only the fields the LLM needs to decide.
  const compact = {
    name: place.title || null,
    google_type: place.type || null,
    types_array: Array.isArray(place.types) ? place.types.slice(0, 6) : [],
    address: place.address || null,
    extensions: summariseExtensions(place.extensions),
    top_review: pickTopReview(place.reviews_data),
    has_phone: !!place.phone,
    has_website: !!place.website,
  };

  const user = `Classify this place. We scraped it under the slug "${queriedSlug ?? 'unknown'}".

${JSON.stringify(compact, null, 2)}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/// Extensions in SerpApi shape are an array of grouped maps. Flatten to
/// a single short array of feature labels so we keep the prompt small.
function summariseExtensions(extensions) {
  if (!Array.isArray(extensions)) return [];
  const out = [];
  for (const group of extensions) {
    if (group && typeof group === 'object') {
      for (const v of Object.values(group)) {
        if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === 'string') out.push(item);
            if (out.length >= 12) return out; // cap
          }
        }
      }
    }
  }
  return out;
}

function pickTopReview(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) return null;
  const first = reviews.find((r) => r?.snippet) || reviews[0];
  if (!first?.snippet) return null;
  // Truncate to keep token usage low.
  return String(first.snippet).slice(0, 220);
}

/// Validate / sanitise the LLM's response. Defensive: if the model
/// hallucinates a slug we don't recognise, we coerce to "other" rather
/// than poisoning the data. Same for malformed attributes.
function normaliseResponse(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const known = new Set(KNOWN_SLUGS);
  const fits = new Set(FIT_VERDICTS);

  const primary = known.has(parsed.primary_slug) ? parsed.primary_slug : 'other';
  const fit = fits.has(parsed.fit_for_queried_slug)
    ? parsed.fit_for_queried_slug
    : 'unrelated';

  const attributes = { ...EMPTY_ATTRIBUTES };
  if (parsed.attributes && typeof parsed.attributes === 'object') {
    for (const k of ATTRIBUTE_KEYS) {
      attributes[k] = parsed.attributes[k] === true;
    }
  }

  const confidence =
    typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

  const reasoning =
    typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 240) : '';

  return {
    primary_slug: primary,
    fit_for_queried_slug: fit,
    attributes,
    confidence,
    reasoning,
  };
}

/// Classify one place via Groq. Throws `all_keys_exhausted` when every
/// key is cooled-down or after every key has been tried for this call.
/// The caller (`classifier/index.js`) catches and falls back to the
/// deterministic heuristic verdict.
export async function classifyWithGroq({ place, queriedSlug }) {
  if (POOL.length === 0) throw new Error('groq_not_configured');

  const messages = buildMessages({ place, queriedSlug });

  let lastErr = null;
  for (let attempt = 0; attempt < POOL.length; attempt++) {
    const slot = pickKey();
    if (!slot) break; // all cooled-down

    try {
      const resp = await slot.client.chat.completions.create({
        model: MODEL,
        messages,
        // JSON mode: Groq enforces parseable JSON on the model's output.
        response_format: { type: 'json_object' },
        // Low temperature — we want consistent classifications, not
        // creative ones.
        temperature: 0.1,
        // Cap output. The schema is small; 400 tokens is plenty.
        max_tokens: 400,
      });
      const text = resp?.choices?.[0]?.message?.content;
      const norm = normaliseResponse(text);
      if (!norm) {
        // Model returned something unparseable — try next key.
        lastErr = new Error('invalid_json_from_model');
        continue;
      }
      return {
        ...norm,
        method: 'llm',
        model: MODEL,
        key_used: slot.name,
      };
    } catch (err) {
      lastErr = err;
      // 429 → cool down this key for a minute.
      if (err?.status === 429 || /rate.?limit/i.test(err?.message || '')) {
        slot.cooledUntil = Date.now() + COOLDOWN_MS_ON_429;
        continue;
      }
      // 5xx, network — try next key immediately without cooling.
      if (err?.status >= 500 && err?.status < 600) continue;
      // 4xx other than 429 (auth, bad request) — same: try next, no cool.
      continue;
    }
  }

  const e = new Error('all_keys_exhausted');
  e.cause = lastErr;
  throw e;
}

/// Visible for testing — lets a smoke test verify pool wiring without
/// making real API calls.
export function _debugPoolStatus() {
  const now = Date.now();
  return POOL.map((s) => ({
    name: s.name,
    cooledDownFor: Math.max(0, s.cooledUntil - now),
  }));
}
