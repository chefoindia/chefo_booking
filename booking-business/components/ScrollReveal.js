"use client";
// components/ScrollReveal.js — the IntersectionObserver that drives the
// landing page's .reveal sections.
//
// A tiny client component rendered inside app/page.js (a server component, so
// its `metadata` export keeps working). useEffect rather than a <script> tag:
// a script only runs on a full page load, and next/script skips an
// already-seen id on a repeat visit to the same route. This fires on every
// mount — full load or client navigation, first visit or fifth.
import { useEffect } from "react";

export default function ScrollReveal() {
    useEffect(() => {
        const els = document.querySelectorAll(".reveal");
        if (!("IntersectionObserver" in window)) {
            els.forEach((el) => el.classList.add("in-view"));
            return;
        }
        const io = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("in-view");
                        io.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
        );
        els.forEach((el) => io.observe(el));
        return () => io.disconnect();
    }, []);

    return null;
}
