"use client";
// components/Topbar.js — business name, the "accepting bookings" switch (the
// booking product's equivalent of Chefo's canteen Open/Closed status), and the
// approval-queue count. Also hosts the hamburger that opens the mobile sidebar.
import Link from "next/link";

function MenuIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
    );
}

export default function Topbar({
    businessName, accepting, canChangeStatus, statusBusy, onStatusChange, pendingCount = 0, onMenuClick,
}) {
    return (
        <header className="topbar">
            <div className="topbar-left">
                <button className="hamburger-btn" onClick={onMenuClick} aria-label="Open menu">
                    <MenuIcon />
                </button>
                <span className="topbar-name" title={businessName}>{businessName || "—"}</span>
            </div>
            <div className="topbar-actions">
                {pendingCount > 0 && (
                    <Link href="/dashboard/requests" className="topbar-pending">
                        {pendingCount} awaiting approval
                    </Link>
                )}
                <label className="small muted topbar-status-label" htmlFor="booking-status">Bookings</label>
                {canChangeStatus ? (
                    <select
                        id="booking-status"
                        className="select topbar-status"
                        value={accepting ? "open" : "closed"}
                        disabled={statusBusy}
                        aria-label="Accepting bookings"
                        onChange={(e) => onStatusChange(e.target.value === "open")}
                    >
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                    </select>
                ) : null}
                <span className={`badge ${accepting ? "badge-green" : "badge-red"}`}>
                    {accepting ? "Open" : "Closed"}
                </span>
            </div>
        </header>
    );
}
