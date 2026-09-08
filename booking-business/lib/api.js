// lib/api.js — the single API client for the operator dashboard.
//
// The session is an httpOnly cookie, so every call carries credentials and no
// token is ever handled in JavaScript. A 401 means the session is gone; callers
// distinguish that from a 403 (signed in, not allowed) via err.status, because
// the two need completely different UI.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:40005";

export class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.status = status;
        this.data = data;
        this.code = data?.code;
    }
}

export async function api(path, { method = "GET", body, headers } = {}) {
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

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: "POST", body });
export const patch = (p, body) => api(p, { method: "PATCH", body });
export const put = (p, body) => api(p, { method: "PUT", body });
export const del = (p, body) => api(p, { method: "DELETE", body });
