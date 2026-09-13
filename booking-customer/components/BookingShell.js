"use client";
// components/BookingShell.js — the app frame every customer tab sits inside,
// and the one place that knows which canteen this is.
//
// WHY A SHELL AT ALL: this used to be two long pages that each fetched the
// canteen, each drew their own header, and each linked to the other with a
// sentence at the bottom. On a phone that reads as a form, not an app — you
// have to finish one thing before you can look at another. A fixed bar at the
// bottom turns the same content into four places you can be, and the canteen's
// identity is fetched ONCE for all of them.
//
// It holds exactly two pieces of shared state:
//   · the canteen (name, rules, today, how far ahead bookings go)
//   · who you are, if the account cookie says so
// Everything date-specific — the day's meals, the calendar, your bookings —
// belongs to the tab showing it, because only that tab knows which day it means.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { get } from "@/lib/api";
import { todayKey } from "@/lib/format";
import BottomTabBar from "@/components/BottomTabBar";

const Ctx = createContext(null);

/** Everything a tab needs about the canteen and the customer. */
export const useBooking = () => {
    const v = useContext(Ctx);
    if (!v) throw new Error("useBooking must be used inside the /b/[slug] layout");
    return v;
};

export default function BookingShell({ children }) {
    const { slug } = useParams();

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Signed in or not is asked once, here, so no tab has to ask again and no
    // tab has to wonder. `checked` separates "not signed in" from "don't know
    // yet" — the Profile tab must not flash a sign-up card at someone who is
    // already signed in.
    const [account, setAccount] = useState({ checked: false, signedIn: false, party: null });

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await get(`/api/public/business/${slug}?date=${todayKey()}`);
            setData(res);
        } catch (e) {
            setError(e.message || "Could not load this canteen.");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [slug]);

    const refreshAccount = useCallback(async () => {
        try {
            const res = await get(`/api/public/business/${slug}/account/me`);
            const next = { checked: true, signedIn: Boolean(res?.party), party: res?.party || null };
            setAccount(next);
            return res;
        } catch {
            // No cookie, or it expired. That is the ordinary case for most
            // customers and is not an error anyone should be shown.
            setAccount({ checked: true, signedIn: false, party: null });
            return null;
        }
    }, [slug]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { refreshAccount(); }, [refreshAccount]);

    const value = {
        slug,
        biz: data?.business || null,
        rules: data?.business?.rules || {},
        today: data?.today || todayKey(),
        maxDate: data?.maxDate || "",
        mealTypesToday: data?.mealTypes || [],
        loading, error, reload: load,
        account, setAccount, refreshAccount,
    };

    return (
        <Ctx.Provider value={value}>
            <div className="app-shell">
                <Topbar biz={value.biz} loading={loading} />
                <div className="app-content">
                    {error && !data ? (
                        <div className="card">
                            <h2 style={{ fontSize: 16, marginBottom: 6 }}>Canteen not found</h2>
                            <p className="small muted">{error} Check the link you were given, or scan the code again.</p>
                        </div>
                    ) : children}
                </div>
                <BottomTabBar slug={slug} />
            </div>
        </Ctx.Provider>
    );
}

// The canteen's name stays on screen on every tab. On a link someone was handed
// or a code they scanned, "which canteen is this?" is a real question.
function Topbar({ biz, loading }) {
    return (
        <div className="app-topbar">
            <span className="app-topbar-mark">
                {biz?.logoUrl
                    ? <img src={biz.logoUrl} alt="" />
                    : (biz?.name || "•").charAt(0).toUpperCase()}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div className="app-topbar-title">
                    {loading && !biz ? "Loading…" : (biz?.name || "Meal booking")}
                </div>
                <div className="app-topbar-sub">
                    {[biz?.addressLine, biz?.landmark, biz?.city].filter(Boolean).join(", ") || "Book your meals"}
                </div>
            </div>
        </div>
    );
}
