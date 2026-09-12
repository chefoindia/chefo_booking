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
    const [pendingCount, setPendingCount] = useState(0);
    const [statusBusy, setStatusBusy] = useState(false);

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

    // The approval queue is the one thing an operator must not miss, so its
    // count lives in the shell and refreshes on a timer rather than only when
    // somebody happens to open that page.
    const refreshPending = useCallback(() => {
        if (!access || !can(access, "requests.view")) return Promise.resolve();
        return get("/api/requests?status=pending&limit=1")
            .then((r) => setPendingCount(r.pendingCount || 0))
            .catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    useEffect(() => {
        if (!ready) return;
        refreshPending();
        const id = setInterval(refreshPending, 30_000);
        return () => clearInterval(id);
    }, [ready, refreshPending, pathname]);

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

    return (
        <Ctx.Provider value={{
            ...state,
            access,
            can: (p) => can(access, p),
            canAny: (ps) => canAny(access, ps),
            reload: load,
            pendingCount,
            refreshPending,
        }}>
            <div className="shell">
                <Sidebar
                    access={access}
                    user={state.user}
                    pendingCount={pendingCount}
                    onLogout={logout}
                    open={navOpen}
                    onClose={() => setNavOpen(false)}
                />
                {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />}

                <div className="main-col">
                    <Topbar
                        businessName={state.business?.name}
                        accepting={state.business?.acceptingBookings !== false}
                        canChangeStatus={can(access, "config.edit")}
                        statusBusy={statusBusy}
                        onStatusChange={changeStatus}
                        pendingCount={pendingCount}
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
