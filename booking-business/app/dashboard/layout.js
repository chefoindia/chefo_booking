"use client";
// app/dashboard/layout.js — the authenticated shell for every dashboard page.
//
// Guards the session, loads who the user is and what they may do, and exposes
// both to every page through one context — the same shape as the Chefo owner
// dashboard's OwnerCtx. ONE round trip (/api/auth/me) gates the first paint;
// the approval-queue count streams in behind it.
//
// The navigation is permission-driven, but hiding a link is UX only — the API
// refuses the same things independently.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { get, post, patch } from "@/lib/api";
import { can, canAny, visibleNav, NAV } from "@/lib/permissions";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import BootSplash from "@/components/BootSplash";
import { useToast } from "@/components/ToastProvider";

const Ctx = createContext(null);
export const useAccess = () => useContext(Ctx);

export default function DashboardLayout({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const toast = useToast();
    const [state, setState] = useState(null);
    const [ready, setReady] = useState(false);
    const [navOpen, setNavOpen] = useState(false);
    const [statusBusy, setStatusBusy] = useState(false);

    /* THE OUTLET SELECTOR'S VALUE. "" = All outlets (or, for a restricted
       user, all of theirs); otherwise an outlet id. Held here so every page
       reads the same choice and it survives navigation; remembered per
       business + user on this device so a counter tablet at Block A opens on
       Block A tomorrow. Every page turns it into `?outletId=` and the API
       enforces it independently — this is a filter the user chose, never a
       permission. */
    const [outlet, setOutletState] = useState("");

    const load = useCallback(async () => {
        try {
            const me = await get("/api/auth/me");
            // Verified their mobile but never finished the wizard. Showing an
            // empty dashboard would be a dead end; the wizard picks up at the
            // business step with what they already entered.
            if (me.setupPending && me.user?.isOwner) {
                router.replace("/auth?resume=business");
                return;
            }
            setState(me);
            setReady(true);
        } catch {
            router.replace("/auth");
        }
    }, [router]);

    useEffect(() => { load(); }, [load]);

    const access = state ? { isOwner: state.user.isOwner, permissions: state.permissions } : null;

    const outletKey = state ? `chefo-booking-outlet:${state.business?._id || ""}:${state.user?.id || ""}` : "";

    // Once the shell knows which outlets this person may see, restore the
    // remembered choice — but only if it is still one of them. A restricted
    // user with exactly one outlet is pinned to it: there is nothing to choose.
    useEffect(() => {
        if (!state) return;
        const visible = state.outlets || [];
        if (Array.isArray(state.outletScope) && visible.length === 1) { setOutletState(String(visible[0].id)); return; }
        let saved = "";
        try { saved = localStorage.getItem(outletKey) || ""; } catch { /* private mode */ }
        const ok = saved && (visible.some((o) => String(o.id) === saved) || (saved === "unassigned" && !Array.isArray(state.outletScope)));
        setOutletState(ok ? saved : "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state?.outlets, state?.outletScope, outletKey]);

    const setOutlet = useCallback((id) => {
        const next = String(id || "");
        setOutletState(next);
        try { next ? localStorage.setItem(outletKey, next) : localStorage.removeItem(outletKey); } catch { /* fine */ }
    }, [outletKey]);

    // There used to be a polled approval count here. There is no approval
    // queue any more — past the deadline a customer cannot act at all — so the
    // shell has nothing to watch for.

    // Close the mobile drawer on every navigation.
    useEffect(() => { setNavOpen(false); }, [pathname]);

    // PAGE-LEVEL PERMISSION GUARD. Hiding a tab doesn't stop someone typing
    // its URL, so a staff member who lands on a module they lack is sent to
    // the first page they may open. UX, not the boundary.
    useEffect(() => {
        if (!ready || !access || access.isOwner) return;
        const item = NAV.find((n) => (n.exact ? pathname === n.href : pathname.startsWith(n.href)));
        if (item && !canAny(access, item.perms)) {
            const first = visibleNav(access)[0];
            if (first) router.replace(first.href);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, pathname, state]);

    const changeStatus = useCallback(async (accepting) => {
        const prev = state.business?.acceptingBookings;
        setState((s) => ({ ...s, business: { ...s.business, acceptingBookings: accepting } }));
        setStatusBusy(true);
        try {
            await patch("/api/config/business", { acceptingBookings: accepting });
            toast("success", accepting ? "Taking bookings" : "Bookings paused",
                accepting ? "Customers can book again." : "Existing bookings are unaffected — only new ones are stopped.");
        } catch (e) {
            setState((s) => ({ ...s, business: { ...s.business, acceptingBookings: prev } }));
            toast("error", "Couldn't update status", e.message);
        } finally {
            setStatusBusy(false);
        }
    }, [state, toast]);

    const logout = async () => {
        try { await post("/api/auth/logout"); } catch { /* clear locally regardless */ }
        router.replace("/auth");
    };

    if (!ready || !state) return <BootSplash label="Signing you in" />;

    const nav = visibleNav(access);

    const outlets = state.outlets || [];
    const selectedOutlet = outlet ? outlets.find((o) => String(o.id) === outlet) || null : null;
    const restricted = Array.isArray(state.outletScope);

    return (
        <Ctx.Provider value={{
            ...state,
            access,
            can: (p) => can(access, p),
            canAny: (ps) => canAny(access, ps),
            reload: load,
            /* Outlets, for every page:
                 outlets        what this person may see (the selector's list)
                 outlet         the selected id, "" = all
                 outletName     a label for headings: "Block A" / "All outlets"
                 outletQs       the query-string fragment to append to API calls
                 outletRequired the business has active outlets, so a new
                                booking must name one */
            outlets,
            outletScope: state.outletScope ?? null,
            outletRequired: Boolean(state.outletRequired),
            outlet,
            selectedOutlet,
            outletName: selectedOutlet ? selectedOutlet.name
                : outlet === "unassigned" ? "Unassigned (before outlets)"
                    : (outlets.length ? (restricted ? "All my outlets" : "All outlets") : ""),
            setOutlet,
            outletQs: outlet ? `outletId=${encodeURIComponent(outlet)}` : "",
            // Kept as a no-op so the pages that called it after acting on a
            // booking do not each need editing to say "nothing to refresh".
            refreshPending: () => {},
        }}>
            <div className="shell">
                <Sidebar
                    access={access}
                    user={state.user}
                    onLogout={logout}
                    open={navOpen}
                    onClose={() => setNavOpen(false)}
                />
                {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />}

                <div className="main-col">
                    <Topbar
                        businessName={state.business?.name}
                        outlets={outlets}
                        outletScope={state.outletScope ?? null}
                        outlet={outlet}
                        onOutletChange={setOutlet}
                        accepting={state.business?.acceptingBookings !== false}
                        canChangeStatus={can(access, "config.edit")}
                        statusBusy={statusBusy}
                        onStatusChange={changeStatus}
                        onMenuClick={() => setNavOpen(true)}
                    />
                    <main className="content">
                        {!nav.length ? (
                            // Somebody with a role that grants nothing would otherwise
                            // land on an empty shell with no explanation of why.
                            <div className="card card-pad" style={{ maxWidth: 520, margin: "48px auto", textAlign: "center" }}>
                                <h2 style={{ fontSize: 18, marginBottom: 8 }}>No access yet</h2>
                                <p className="page-sub" style={{ margin: 0 }}>
                                    Your account is active{state.user.roleName ? ` with the role “${state.user.roleName}”` : ""},
                                    but it hasn’t been given permission to open anything yet. Ask the business
                                    owner to assign you a role.
                                </p>
                            </div>
                        ) : children}
                    </main>
                </div>
            </div>
        </Ctx.Provider>
    );
}
