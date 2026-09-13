"use client";
// lib/mybookings.js — "show me my bookings", answered without asking who you are.
//
// Three sources, tried in order, and the customer is told about none of them:
//   1. the account cookie — if it is valid they type nothing, ever again;
//   2. the device ledger — the tickets this browser collected, refreshed in ONE
//      call so the statuses are the canteen's truth and not a stale copy;
//   3. the phone lookup — for a brand new device belonging to someone who never
//      made an account. This one has to be asked for, so it is not in here.
//
// Whatever answers first wins. Anything that comes back is merged INTO the
// ledger, so a booking made on a laptop appears on the phone the moment either
// device finds it.
//
// It lives in lib/ rather than in a page because two tabs need the same answer:
// Home shows the next one, Bookings shows all of them, and two copies of this
// logic would eventually disagree about which is which.
import { get, post } from "@/lib/api";
import { readLedger, addToLedger, removeFromLedger, writeMe } from "@/lib/ledger";

/** Every server answer teaches this device something. */
export function adopt(slug, list) {
    for (const b of list || []) if (b?.ticket) addToLedger(slug, b);
}

export async function fromAccount(slug) {
    const res = await get(`/api/public/business/${slug}/account/me`);
    if (!res?.party) return null;
    adopt(slug, res.bookings);
    return { source: "account", party: res.party, bookings: res.bookings || [] };
}

export async function fromLedger(slug) {
    const entries = readLedger(slug) || [];
    const tickets = entries.map((e) => e.ticket).filter(Boolean).slice(0, 100);
    if (!tickets.length) return null;

    // A POST that reads: it carries a list of tickets, nothing more.
    const res = await post(`/api/public/business/${slug}/tickets`, { tickets }, { readOnly: true });
    const list = res?.bookings || [];
    adopt(slug, list);

    // This was a successful answer about exactly these tickets, so anything
    // missing from it is genuinely unknown to the canteen — a ticket from
    // another business, or one that no longer exists. Dropping it keeps the
    // ledger from rotting. Skipped entirely if any booking came back without a
    // ticket, rather than risk pruning a live one.
    if (list.every((x) => x?.ticket)) {
        const seen = new Set(list.map((x) => x.ticket));
        for (const t of tickets) if (!seen.has(t)) removeFromLedger(slug, t);
    }
    return { source: "ledger", party: null, bookings: list };
}

export async function fromPhone(slug, raw) {
    const p = String(raw || "").trim();
    if (!p) return null;
    const res = await post(`/api/public/business/${slug}/lookup`, { phone: p }, { readOnly: true });
    adopt(slug, res?.bookings);
    writeMe({ phone: p.replace(/\D/g, "").slice(-10) });
    return { source: "phone", party: res?.party || null, bookings: res?.bookings || [] };
}

/**
 * The two silent sources, in order. Returns null when neither knows anything —
 * which is the signal to ask for a phone number, not an error.
 */
export async function loadMine(slug) {
    try {
        const a = await fromAccount(slug);
        if (a) return a;
    } catch { /* no cookie, or it expired — the ordinary case */ }
    try {
        return await fromLedger(slug);
    } catch {
        return null;
    }
}

export const CLOSED_STATUSES = ["cancelled", "rejected"];

/** Upcoming = still ahead and still alive. Presentation, not policy. */
export const isUpcoming = (b, today) =>
    b.date >= today && !CLOSED_STATUSES.includes(b.status);

export function splitByTime(list, today) {
    const all = list || [];
    return {
        upcoming: all.filter((b) => isUpcoming(b, today)).sort((a, x) => a.date.localeCompare(x.date)),
        past: all.filter((b) => !isUpcoming(b, today)).sort((a, x) => x.date.localeCompare(a.date)),
    };
}
