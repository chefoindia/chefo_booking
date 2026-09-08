"use client";
// Root of the customer app.
//
// A business is addressed by slug (/b/<slug>) so one deployment serves many
// canteens. A single-operator deployment can set NEXT_PUBLIC_DEFAULT_BUSINESS
// and have the bare domain resolve straight to them.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";

export default function Home() {
    const router = useRouter();
    const fallback = process.env.NEXT_PUBLIC_DEFAULT_BUSINESS;

    useEffect(() => {
        if (fallback) router.replace(`/b/${fallback}`);
    }, [fallback, router]);

    if (fallback) return <div className="wrap"><div className="sk" style={{ height: 200 }} /></div>;

    return (
        <div className="wrap">
            <div className="head">
                <span className="head-mark">B</span>
                <div>
                    <div className="head-name">{BRAND.productName}</div>
                    <div className="head-sub">Meal bookings</div>
                </div>
            </div>
            <div className="card">
                <h2 style={{ fontSize: 16, marginBottom: 6 }}>Open your canteen&apos;s booking link</h2>
                <p className="small muted">
                    Booking pages live at a link your canteen gives you. Ask them for it,
                    or scan the code they display.
                </p>
            </div>
        </div>
    );
}
