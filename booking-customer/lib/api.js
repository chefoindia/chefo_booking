// lib/api.js — the single API client for the customer app.
//
// The session is an httpOnly cookie, so every call carries credentials and no
// token is ever handled in JavaScript. A 401 means the session is gone; callers
// distinguish that from a 403 (signed in, not allowed) via err.status, because
// the two need completely different UI.
//
// GETs ARE DE-DUPLICATED AND BRIEFLY CACHED. This app is four tabs over one
// canteen: the shell asks who you are, the tab you land on asks the same thing,
// and switching tabs asks for the same day's meals again. On canteen wifi each
// of those is a visible pause. Two identical GETs in flight at once become one
// request, and a repeat within a few seconds is answered from memory.
//
// The cache is deliberately dumb and short-lived, and ANY write empties it —
// a customer who cancels a booking must never still see it because a
// six-second-old copy was lying around.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:40005";

const TTL_MS = 8000;
const cache = new Map();      // path -> { at, data }
const inflight = new Map();   // path -> Promise

export class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.status = status;
        this.data = data;
        this.code = data?.code;
    }
}

/** Forget everything. Called after every write, and available to callers. */
export function clearCache() {
    cache.clear();
    inflight.clear();
}

async function request(path, { method = "GET", body, headers } = {}) {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        credentials: "include",
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }

    if (!res.ok) throw new ApiError(data?.message || `Request failed (${res.status})`, res.status, data);
    return data;
}

export async function api(path, opts = {}) {
    // Anything that changes the server makes every cached answer suspect.
    // Cheaper to refetch than to work out which paths this one touched.
    //
    // `readOnly` is the exception, and it earns its keep: two of this app's
    // lookups are POSTs only because they carry a list of tickets or a phone
    // number in the body. They change nothing, and letting them wipe the cache
    // meant every tab re-fetched the canteen after every lookup.
    if ((opts.method || "GET") !== "GET" && !opts.readOnly) clearCache();
    return request(path, opts);
}

/**
 * A GET that will happily share its answer.
 *
 * `fresh: true` skips the cache but still joins an in-flight request, which is
 * what a reload after an action wants: current data, without firing a second
 * copy of a call already on the wire.
 */
export async function get(path, { fresh = false, ttl = TTL_MS } = {}) {
    if (!fresh) {
        const hit = cache.get(path);
        if (hit && Date.now() - hit.at < ttl) return hit.data;
    }

    const pending = inflight.get(path);
    if (pending) return pending;

    const p = request(path)
        .then((data) => {
            cache.set(path, { at: Date.now(), data });
            return data;
        })
        .finally(() => { inflight.delete(path); });

    inflight.set(path, p);
    return p;
}

export const post = (p, body, opts = {}) => api(p, { method: "POST", body, ...opts });
export const patch = (p, body) => api(p, { method: "PATCH", body });
export const put = (p, body) => api(p, { method: "PUT", body });
export const del = (p, body) => api(p, { method: "DELETE", body });
