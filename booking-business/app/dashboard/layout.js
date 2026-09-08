"use client";
// The authenticated shell. Guards the session, loads who the user is and what
// they may do, and exposes both to every page through one context.
//
// The navigation is permission-driven, but hiding a link is UX only — the API
// refuses the same things independently. A staff member who types a URL they
// lack permission for gets bounced here, and would have got an empty 403 page
// anyway.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { get, post } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { can, canAny, visibleNav, NAV } from "@/lib/permissions";

const Ctx = createContext(null);
export const useAccess = () => useContext(Ctx);

export default function DashboardLayout({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const [state, setState] = useState(null);
    const [ready, setReady] = useState(false);
    const [navOpen, setNavOpen] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);

    const load = useCallback(async () => {
        try {
            const me = await get("/api/auth/me");
            setState(me);
            setReady(true);
        } catch {
            router.replace("/login");
        }
    }, [router]);

    useEffect(() => { load(); }, [load]);

    // The approval queue is the one thing an operator must not miss, so its
    // count lives in the shell and refreshes on a timer rather than only when
    // somebody happens to open that page.
    useEffect(() => {
        if (!ready || !state) return;
        const access = { isOwner: state.user.isOwner, permissions: state.permissions };
        if (!can(access, "requests.view")) return;

        let alive = true;
        const tick = () => get("/api/requests?status=pending&limit=1")
            .then((r) => { if (alive) setPendingCount(r.pendingCount || 0); })
            .catch(() => {});
        tick();
        const id = setInterval(tick, 30_000);
        return () => { alive = false; clearInterval(id); };
    }, [ready, state, pathname]);

    useEffect(() => { setNavOpen(false); }, [pathname]);

    const logout = async () => {
        try { await post("/api/auth/logout"); } catch { /* clear locally regardless */ }
        router.replace("/login");
    };

    if (!ready || !state) {
        return <div style={{ padding: 40 }} className="muted">Loading…</div>;
    }

    const access = { isOwner: state.user.isOwner, permissions: state.permissions };
    const nav = visibleNav(access);

    // Somebody with a role that grants nothing would otherwise land on an empty
    // shell with no explanation of why.
    if (!nav.length) {
        return (
            <div style={{ padding: 40, maxWidth: 460, margin: "60px auto" }} className="card card-pad">
                <h2 style={{ fontSize: 17, marginBottom: 6 }}>No access yet</h2>
                <p className="small muted">
                    Your account is active{state.user.roleName ? ` with the role “${state.user.roleName}”` : ""},
                    but it hasn’t been given permission to open anything yet. Ask the business
                    owner to assign you a role.
                </p>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={logout}>
                    Sign out
                </button>
            </div>
        );
    }

    return (
        <Ctx.Provider value={{
            ...state,
            access,
            can: (p) => can(access, p),
            canAny: (ps) => canAny(access, ps),
            reload: load,
            pendingCount,
            refreshPending: () => get("/api/requests?status=pending&limit=1")
                .then((r) => setPendingCount(r.pendingCount || 0)).catch(() => {}),
        }}>
            <div className="shell">
                <nav className={`sidebar ${navOpen ? "open" : ""}`}>
                    <div className="sidebar-brand">
                        <span className="brand-mark">B</span>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ lineHeight: 1.15 }}>{BRAND.shortName}</div>
                            <div className="brand-sub" style={{
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                                {state.business?.name}
                            </div>
                        </div>
                    </div>

                    <div className="sidebar-nav">
                        {nav.map((item) => {
                            const active = item.href === "/dashboard"
                                ? pathname === "/dashboard"
                                : pathname.startsWith(item.href);
                            return (
                                <Link key={item.key} href={item.href}
                                    className={`side-link ${active ? "active" : ""}`}>
                                    <span>{item.label}</span>
                                    {item.key === "requests" && pendingCount > 0 && (
                                        <span className="badge badge-amber">{pendingCount}</span>
                                    )}
                                </Link>
                            );
                        })}
                    </div>

                    <div className="side-foot">
                        <div className="side-user">
                            <strong>{state.user.name}</strong>
                            {state.user.isOwner ? "Owner" : (state.user.roleName || "No role")}
                        </div>
                        <button className="btn btn-ghost btn-sm btn-block" onClick={logout}>Sign out</button>
                    </div>
                </nav>

                {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />}

                <div className="main-col">
                    <div className="topbar">
                        <button className="btn btn-ghost btn-sm only-sm" onClick={() => setNavOpen(true)}>
                            ☰ Menu
                        </button>
                        <div className="row grow" style={{ minWidth: 0 }}>
                            <strong className="hide-sm" style={{ fontSize: 14 }}>{state.business?.name}</strong>
                            {state.business?.acceptingBookings === false && (
                                <span className="badge badge-red">Not accepting bookings</span>
                            )}
                        </div>
                        {pendingCount > 0 && (
                            <Link href="/dashboard/requests" className="badge badge-amber">
                                {pendingCount} awaiting approval
                            </Link>
                        )}
                    </div>
                    <main className="content">{children}</main>
                </div>
            </div>
        </Ctx.Provider>
    );
}
