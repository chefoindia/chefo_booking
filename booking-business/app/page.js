"use client";
// Entry point: send people wherever they actually belong. The dashboard layout
// does the real session check; this only avoids a blank root URL.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { get } from "@/lib/api";

export default function Home() {
    const router = useRouter();
    useEffect(() => {
        get("/api/auth/me")
            .then(() => router.replace("/dashboard"))
            .catch(() => router.replace("/login"));
    }, [router]);
    return <div style={{ padding: 40 }} className="muted">Loading…</div>;
}
