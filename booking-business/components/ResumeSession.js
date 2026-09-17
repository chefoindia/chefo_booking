"use client";
// components/ResumeSession.js — send an already-signed-in operator straight to
// their dashboard instead of the marketing page.
//
// WHY A CLIENT ISLAND AND NOT A SERVER REDIRECT. The session is an httpOnly
// cookie set by the API on ITS origin, and the dashboard reaches it with
// `credentials: "include"`. The Next server never receives that cookie, so it
// cannot know who is asking — only the browser can. `app/page.js` therefore
// stays a server component (its `metadata` export is what search engines read)
// and this mounts inside it.
//
// The landing page is NOT held back while the check runs. An anonymous visitor
// is the common case by a wide margin, and blocking first paint on a network
// round trip to show them a page they were always going to get is the wrong
// trade. A signed-in operator sees the hero for a moment and then lands on the
// dashboard.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { get } from "@/lib/api";

export default function ResumeSession() {
    const router = useRouter();

    useEffect(() => {
        // An escape hatch, because otherwise signing in makes your own public
        // page unreachable in that browser — there would be no way to look at
        // the pricing or the FAQ without signing out first.
        if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("stay")) return;

        let alive = true;
        get("/api/auth/me")
            .then((me) => {
                if (!alive) return;
                // Same branch the dashboard shell takes: someone who verified a
                // mobile but never finished the wizard has no dashboard to land
                // on, and would be bounced straight back here.
                router.replace(me?.setupPending && me?.user?.isOwner ? "/auth?resume=business" : "/dashboard");
            })
            .catch(() => { /* not signed in, or the API is down — stay put */ });
        return () => { alive = false; };
    }, [router]);

    return null;
}
