"use client";
// components/OutletScopeLine.js — two small things every page that lists or
// counts bookings shows, so the outlet is never ambiguous on screen.
//
//   <OutletScopeLine />       under a page title: "Showing Block A" or
//                             "All outlets" — the current selector value,
//                             said in words next to the numbers it governs.
//   <OutletTag booking />     next to a booking anywhere: its own outlet,
//                             from the booking's snapshot, or "No outlet" for
//                             one that predates outlets. Never the selector.
import { useAccess } from "@/app/dashboard/layout";
import { OutletIcon } from "@/components/OutletSelector";

export default function OutletScopeLine() {
    const access = useAccess();
    if (!access.outlets?.length) return null;
    return (
        <span className="outlet-scope-line">
            <OutletIcon size={13} />
            <span>{access.outlet ? `Showing ${access.outletName}` : access.outletName}</span>
        </span>
    );
}

export function OutletTag({ booking, quiet = false }) {
    if (!booking) return null;
    if (!booking.outletName && !booking.outletId) {
        return quiet ? null : <span className="badge badge-gray" title="Booked before this business had outlets">No outlet</span>;
    }
    return (
        <span className="badge badge-blue" title="The outlet this booking belongs to">
            {booking.outletName || "Outlet"}
        </span>
    );
}
