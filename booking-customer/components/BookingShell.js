"use client";
// components/BookingShell.js — the app frame every customer tab sits inside,
// and the one place that knows which canteen this is.
//
// It holds exactly three pieces of shared state:
//   · the canteen (name, rules, today, how far ahead bookings go)
//   · who you are, if the account cookie says so
//   · what this phone has booked, fetched once for every tab
// Everything date-specific — the day's meals, the calendar — belongs to the
// tab showing it, because only that tab knows which day it means.
//
// THE BOOKING FORM LIVES HERE, not on a page. It is a bottom sheet over
// whichever tab you were on, opened from the raised Book button, a meal on
// Home, a day on the calendar or a service on the menu — always the same thing,
// never a navigation away from what you were reading.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { get } from "@/lib/api";
import { todayKey, cutoffInfo } from "@/lib/format";
import { loadMine } from "@/lib/mybookings";
import BottomTabBar from "@/components/BottomTabBar";
import BookSheet from "@/components/BookSheet";
import { Icon, PATHS } from "@/components/Icons";
import useNow from "@/lib/useNow";

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

    // `checked` separates "not signed in" from "don't know yet" — the Profile
    // tab must not flash a sign-up card at someone who is already signed in.
    const [account, setAccount] = useState({ checked: false, signedIn: false, party: null });

    // What this phone has booked, fetched ONCE for the whole app.
    const [mine, setMine] = useState({ loaded: false, source: "", party: null, bookings: [] });

    const [booking, setBooking] = useState(null);   // null = closed
    const openBooking = useCallback((opts = {}) => {
        setBooking({ date: opts.date || "", meal: opts.meal || "" });
    }, []);

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
            setAccount({ checked: true, signedIn: false, party: null });
            return null;
        }
    }, [slug]);

    const refreshMine = useCallback(async () => {
        try {
            const r = await loadMine(slug);
            const next = r
                ? { loaded: true, source: r.source, party: r.party, bookings: r.bookings || [] }
                : { loaded: true, source: "", party: null, bookings: [] };
            setMine(next);
            return next;
        } catch {
            setMine({ loaded: true, source: "", party: null, bookings: [] });
            return null;
        }
    }, [slug]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { refreshAccount(); }, [refreshAccount]);
    useEffect(() => {
        if (!account.checked) return;
        refreshMine();
    }, [account.checked, refreshMine]);

    const value = {
        slug,
        biz: data?.business || null,
        rules: data?.business?.rules || {},
        today: data?.today || todayKey(),
        maxDate: data?.maxDate || "",
        mealTypesToday: data?.mealTypes || [],
        loading, error, reload: load,
        account, setAccount, refreshAccount,
        mine, setMine, refreshMine,
        openBooking, bookingOpen: Boolean(booking),
    };

    return (
        <Ctx.Provider value={value}>
            <div className="app-shell">
                <Topbar biz={value.biz} loading={loading} meals={value.mealTypesToday} today={value.today} />
                <div className="app-content">
                    {error && !data ? (
                        <div className="card center" style={{ padding: 28 }}>
                            <div className="done-mark" style={{ background: "var(--brick-soft)", color: "var(--brick)" }}>
                                <Icon d={PATHS.pin} size={30} />
                            </div>
                            <h2 style={{ fontSize: 17, marginBottom: 6 }}>Canteen not found</h2>
                            <p className="small muted">{error} Check the link you were given, or scan the code again.</p>
                        </div>
                    ) : children}
                </div>
                <BottomTabBar slug={slug} onBook={() => openBooking({ date: value.today })} />

                <BookSheet
                    open={Boolean(booking)}
                    slug={slug}
                    biz={value.biz}
                    rules={value.rules}
                    today={value.today}
                    maxDate={value.maxDate}
                    account={account}
                    mine={mine}
                    initialDate={booking?.date}
                    initialMeal={booking?.meal}
                    onClose={() => setBooking(null)}
                    onBooked={() => { refreshMine(); load(); }}
                />
            </div>
        </Ctx.Provider>
    );
}

// The canteen's name stays on screen on every tab, with a one-word answer to
// "can I still book something today?" beside it.
function Topbar({ biz, loading, meals, today }) {
    const now = useNow(30000);
    const open = (meals || []).filter((m) => !["closed", "not-served"].includes(cutoffInfo(m, now, today).state));
    const closing = open.map((m) => cutoffInfo(m, now, today)).filter((i) => i.state === "closing");
    const pill = !biz ? null
        : biz.acceptingBookings === false ? { cls: "badge-red", text: "Closed" }
            : closing.length ? { cls: "badge-amber", text: `Closes ${closing[0].badge.replace("Closes ", "")}` }
                : open.length ? { cls: "badge-green", text: `${open.length} open today` }
                    : { cls: "badge-gray", text: "Book ahead" };

    return (
        <div className="app-topbar">
            <span className="app-topbar-mark">
                {biz?.logoUrl ? <img src={biz.logoUrl} alt="" /> : (biz?.name || "•").charAt(0).toUpperCase()}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div className="app-topbar-title">{loading && !biz ? "Loading…" : (biz?.name || "Meal booking")}</div>
                <div className="app-topbar-sub">
                    {[biz?.addressLine, biz?.landmark, biz?.city].filter(Boolean).join(", ") || "Book your meals ahead"}
                </div>
            </div>
            {pill && <span className={`badge badge-dot ${pill.cls}`}>{pill.text}</span>}
        </div>
    );
}
