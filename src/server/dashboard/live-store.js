// Server-side streaming cache for the dashboard.
//
// What this solves:
//   Previous pattern → every dashboard tab open did a full Firestore
//   query. Sub / reports / inquiries / users / stats are each ~100-400
//   reads. A single admin session opening every tab burned ~5,000
//   reads. At 10 sessions/day the dashboard ate the entire 50k/day
//   free tier.
//
// What this does:
//   Holds a single `snapshots()` listener per "hot" collection. The
//   listener delivers the initial snapshot once (1 read per doc, paid
//   ONCE at server boot) and then 1 read per change. Dashboard
//   endpoints query the in-memory array — zero Firestore reads after
//   the warmup.
//
//   Net effect: dashboard cost drops from ~5k reads per admin
//   session to ~5k reads per SERVER PROCESS (warmup) + ~1 read per
//   mutation. With Render's free-tier instance staying warm under
//   load, that's roughly 50k → 50 reads/day for the same admin
//   activity.
//
// Hot collections (streamed):
//   - place_submissions  (mutated on every approve/reject/edit)
//   - place_reports       (mutated on every resolve)
//   - place_inquiries     (mutated on every send + resolve)
//   - users               (rarely mutated, but listing is cheap)
//
// NOT streamed:
//   - places              (~4,400 docs — too large for a comfortable
//                          memory + sub cost; keeps its 5-min TTL
//                          cache in admin-queries.js)
//   - catalogue_buckets   (already small + already real-time on the
//                          mobile side)

import { getFirestore } from '../../pipeline/firestore.js';

// One Store per collection. Holds:
//   - data: Map<docId, docData>
//   - readyPromise: resolves on the first snapshot delivery
//   - lastError / lastReceivedAt: for the /omar-dash health view
class Store {
  constructor(name, options = {}) {
    this.name = name;
    this.data = new Map();
    this.lastError = null;
    this.lastReceivedAt = 0;
    this.unsubscribe = null;
    this._ready = null;
    this._readyResolve = null;
    this._readyPromise = new Promise((resolve) => {
      this._readyResolve = resolve;
    });
    // Optional: max docs to keep (apply orderBy + limit so memory
    // doesn't grow unbounded on a slow-burn collection). Default
    // unbounded for collections of this scale.
    this.orderBy = options.orderBy || null;       // { field, direction }
    this.limit = options.limit || null;
  }

  /// Subscribe to the collection. Idempotent — safe to call repeatedly
  /// (no-op if already subscribed). Returns a Promise that resolves
  /// when the first snapshot lands (so callers can `await ready()`).
  async subscribe() {
    if (this.unsubscribe) return this._readyPromise;
    const db = await getFirestore();
    let query = db.collection(this.name);
    if (this.orderBy) {
      query = query.orderBy(this.orderBy.field, this.orderBy.direction);
    }
    if (this.limit) {
      query = query.limit(this.limit);
    }
    this.unsubscribe = query.onSnapshot(
      (snap) => {
        // Replace the in-memory map wholesale on each snapshot. The
        // initial snapshot delivers every doc (paid as N reads, one
        // time). Subsequent snapshots deliver only the changed docs,
        // but the snap.docs array always reflects the FULL current
        // state, so we can just rebuild without missing anything.
        const next = new Map();
        for (const doc of snap.docs) {
          next.set(doc.id, doc.data());
        }
        this.data = next;
        this.lastReceivedAt = Date.now();
        if (this._readyResolve) {
          this._readyResolve();
          this._readyResolve = null;
        }
      },
      (err) => {
        this.lastError = err;
        console.warn(`[live-store] ${this.name} listener error:`,
            err.message);
        // Still resolve ready() so callers don't hang forever — they'll
        // see an empty store and the next endpoint hit can decide how
        // to surface this.
        if (this._readyResolve) {
          this._readyResolve();
          this._readyResolve = null;
        }
      },
    );
    return this._readyPromise;
  }

  /// Wait for the first snapshot to land. After that, this is a no-op.
  async ready() { return this._readyPromise; }

  /// Snapshot of every doc as `[ { id, ...data }, ... ]`. Cheap — a
  /// shallow walk over the in-memory map.
  all() {
    const out = [];
    for (const [id, data] of this.data) out.push({ id, ...data });
    return out;
  }

  /// Count of docs where data[field] === value. O(n) over the in-
  /// memory map, but n is small for these collections (~hundreds).
  countWhere(field, value) {
    let n = 0;
    for (const data of this.data.values()) {
      if (data[field] === value) n++;
    }
    return n;
  }

  size() { return this.data.size; }
}

// ── Module-level stores ─────────────────────────────────────────────

const stores = {
  place_submissions: new Store('place_submissions', {
    orderBy: { field: 'submitted_at', direction: 'desc' },
    // Cap memory at the last 2,000 submissions. Far more than we
    // ever show in any dashboard view (limit=500 max), and bounds
    // the warmup cost. If a collection ever exceeds this, the OLDEST
    // entries fall out of scope — those would only matter for
    // historical audit, which can be done via a one-off query.
    limit: 2000,
  }),
  place_reports: new Store('place_reports', {
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 2000,
  }),
  place_inquiries: new Store('place_inquiries', {
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 2000,
  }),
  users: new Store('users', {
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 2000,
  }),
};

let _bootPromise = null;

/// Subscribe to every store. Safe to call repeatedly — internal flag
/// guarantees we only open each listener once. Call once at server
/// boot (or lazily on first dashboard request).
export async function bootLiveStores() {
  if (_bootPromise) return _bootPromise;
  _bootPromise = (async () => {
    await Promise.all(Object.values(stores).map((s) => s.subscribe()));
    console.log('[live-store] all dashboard streams warm');
  })();
  return _bootPromise;
}

/// Get a snapshot of a named store. Throws if the name is unknown.
/// Auto-subscribes if not already + awaits the first snapshot. After
/// that it's instant.
export async function getStore(name) {
  const store = stores[name];
  if (!store) throw new Error(`Unknown live store: ${name}`);
  await store.subscribe();
  return store;
}

/// Health snapshot — used by the /omar-dash/_health probe to verify
/// every listener is delivering.
export function liveStoreHealth() {
  const out = {};
  for (const [name, s] of Object.entries(stores)) {
    out[name] = {
      size: s.size(),
      last_received_iso: s.lastReceivedAt
          ? new Date(s.lastReceivedAt).toISOString() : null,
      last_error: s.lastError ? s.lastError.message : null,
      subscribed: !!s.unsubscribe,
    };
  }
  return out;
}
