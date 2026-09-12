// lib/download.js — fetch an authenticated file (CSV) and hand it to the
// browser as a download. A plain <a href> can't carry the session cookie's
// error handling — a 403 would open as a page of JSON — so this fetches,
// checks, then saves.
import { API_URL } from "@/lib/api";

export async function downloadFromApi(path, fallbackName = "export.csv") {
    const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
    if (!res.ok) {
        let message = `Download failed (${res.status})`;
        try { message = (await res.json()).message || message; } catch { /* not JSON */ }
        throw new Error(message);
    }
    const disposition = res.headers.get("content-disposition") || "";
    const m = disposition.match(/filename="?([^";]+)"?/);
    saveBlob(await res.blob(), m ? m[1] : fallbackName);
}

export function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
