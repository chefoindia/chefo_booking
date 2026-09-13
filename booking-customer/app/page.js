"use client";
// Root of the customer app — the screen nobody is supposed to land on.
//
// A booking page belongs to ONE canteen and lives at /b/<slug>, because one
// deployment serves many of them. So arriving at the bare domain means the
// customer got here without the thing that identifies their canteen: they typed
// the address from memory, followed a shortened link, or their browser
// autocompleted the domain and dropped the rest.
//
// The old version of this screen said "ask them for it" and stopped, which
// leaves somebody standing in a lunch queue with nothing to do. This one says
// what they have actually lost, gives the two ways to get it back, and — since
// the canteen's name is printed under the QR code on every poster — lets them
// type it in and go.
//
// A single-canteen deployment sets NEXT_PUBLIC_DEFAULT_BUSINESS and never sees
// any of this; the bare domain resolves straight to them.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { BRAND } from "@/lib/brand";
import { readLedger, KEY } from "@/lib/ledger";

// What a slug looks like: lowercase words joined by hyphens. Typed input is
// nudged into that shape rather than refused, because "Sunrise Kitchen" written
// off a poster is the same answer as "sunrise-kitchen".
const toSlug = (raw) => String(raw || "")
    .trim().toLowerCase()
    .replace(/^https?:\/\/[^/]+\/b\//, "")   // a whole pasted link is fine too
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function Home() {
    const router = useRouter();
    const fallback = process.env.NEXT_PUBLIC_DEFAULT_BUSINESS;

    const [code, setCode] = useState("");
    // Canteens this phone has booked at before. If somebody has lost the link
    // once, they have almost certainly used it before, and the answer is
    // already sitting in their own browser.
    const [recent, setRecent] = useState([]);

    useEffect(() => {
        if (fallback) router.replace(`/b/${fallback}`);
    }, [fallback, router]);

    useEffect(() => {
        if (fallback) return;
        try {
            const prefix = KEY("");
            const found = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith(prefix)) continue;
                const slug = k.slice(prefix.length);
                if (slug && readLedger(slug).length) found.push(slug);
            }
            setRecent(found.slice(0, 5));
        } catch { /* private mode — the box below still works */ }
    }, [fallback]);

    if (fallback) return <div className="wrap"><div className="sk" style={{ height: 200 }} /></div>;

    const slug = toSlug(code);
    const go = (e) => {
        e?.preventDefault();
        if (slug) router.push(`/b/${slug}`);
    };

    return (
        <div className="wrap">
            <div className="head">
                <span className="head-mark"><Image src="/chefo-mark.png" alt="Chefo" width={42} height={42} /></span>
                <div>
                    <div className="head-name">{BRAND.productName}</div>
                    <div className="head-sub">Book your canteen&apos;s meals ahead</div>
                </div>
            </div>

            <div className="card">
                <h2 style={{ fontSize: 17, marginBottom: 7 }}>This link is missing your canteen</h2>
                <p className="small muted">
                    Every canteen has its own booking page, so the address needs their name
                    on the end of it &mdash; like{" "}
                    <span className="mono nowrap">{BRAND.domain}/b/your-canteen</span>.
                    You&apos;ve landed on the part before that.
                </p>
            </div>

            {/* The fastest way back, for somebody who has booked here before. */}
            {recent.length > 0 && (
                <>
                    <h3 className="sec-h">Where you&apos;ve booked before</h3>
                    {recent.map((s) => (
                        <button key={s} type="button" className="card card-tap recent-row"
                            onClick={() => router.push(`/b/${s}`)}>
                            <span className="recent-name">{s.replace(/-/g, " ")}</span>
                            <span className="recent-go" aria-hidden="true">&rsaquo;</span>
                        </button>
                    ))}
                </>
            )}

            <h3 className="sec-h">Two ways to get there</h3>

            <div className="card">
                <div className="way">
                    <span className="way-n">1</span>
                    <div>
                        <strong>Scan the code at the counter</strong>
                        <p className="small muted" style={{ marginTop: 3 }}>
                            Most canteens print theirs on a poster by the till or on the notice
                            board. Your phone&apos;s camera opens it &mdash; there is nothing to install.
                        </p>
                    </div>
                </div>

                <div className="way" style={{ marginTop: 14 }}>
                    <span className="way-n">2</span>
                    <div>
                        <strong>Type the name under the code</strong>
                        <p className="small muted" style={{ marginTop: 3 }}>
                            The poster prints it below the QR. Enter it here, or paste the whole
                            link if somebody sent you one.
                        </p>
                        <form onSubmit={go} style={{ marginTop: 9 }}>
                            <input className="input" placeholder="e.g. sunrise-kitchen"
                                autoCapitalize="none" autoCorrect="off" spellCheck="false"
                                value={code} onChange={(e) => setCode(e.target.value)} />
                            <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={!slug}>
                                Open booking page
                            </button>
                            {slug && slug !== code.trim().toLowerCase() && (
                                <span className="hint">Opening <span className="mono">{slug}</span></span>
                            )}
                        </form>
                    </div>
                </div>
            </div>

            <p className="small muted center" style={{ marginTop: 4 }}>
                No account, no app, no password &mdash; booking takes a name and a mobile number.
            </p>

            <p className="powered">Powered by <strong>{BRAND.company}</strong> {BRAND.shortName}</p>

            <style>{`
              .nowrap { white-space: nowrap; }
              .way { display: flex; gap: 11px; align-items: flex-start; }
              .way-n {
                width: 22px; height: 22px; border-radius: 999px; flex-shrink: 0; margin-top: 1px;
                background: var(--basil-soft); color: var(--basil-dark);
                font-size: 12px; font-weight: 700; display: grid; place-items: center;
              }
              .recent-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
              .recent-name { font-weight: 600; text-transform: capitalize; }
              .recent-go { color: var(--faint); font-size: 20px; line-height: 1; }
            `}</style>
        </div>
    );
}
