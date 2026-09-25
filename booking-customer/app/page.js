"use client";
// Root of the customer app — the screen nobody is supposed to land on.
//
// A booking page belongs to ONE canteen and lives at /b/<slug>. Arriving at
// the bare domain means the customer got here without the thing that
// identifies their canteen. This screen says what they have lost, gives the
// two ways to get it back, and — since the canteen's name is printed under
// the QR code on every poster — lets them type it in and go.
//
// A single-canteen deployment sets NEXT_PUBLIC_DEFAULT_BUSINESS and never
// sees any of this; the bare domain resolves straight to them.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { BRAND } from "@/lib/brand";
import { readLedger, KEY } from "@/lib/ledger";
import { Icon, PATHS } from "@/components/Icons";

const toSlug = (raw) => String(raw || "")
    .trim().toLowerCase()
    .replace(/^https?:\/\/[^/]+\/b\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function Home() {
    const router = useRouter();
    const fallback = process.env.NEXT_PUBLIC_DEFAULT_BUSINESS;
    const [code, setCode] = useState("");
    const [recent, setRecent] = useState([]);

    useEffect(() => { if (fallback) router.replace(`/b/${fallback}`); }, [fallback, router]);

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
    const go = (e) => { e?.preventDefault(); if (slug) router.push(`/b/${slug}`); };

    return (
        <div className="wrap">
            <div className="land-hero">
                <span className="land-mark"><Image src="/chefo-mark.png" alt="Chefo" width={60} height={60} /></span>
                <div className="hero-kicker" style={{ color: "var(--basil-dark)" }}>{BRAND.productName}</div>
                <h1 style={{ fontSize: 26, marginTop: 4 }}>This link is missing your canteen</h1>
                <p className="muted" style={{ marginTop: 8, lineHeight: 1.55 }}>
                    Every canteen has its own booking page, so the address needs their name on the end —
                    like <span className="mono" style={{ whiteSpace: "nowrap" }}>{BRAND.domain}/b/your-canteen</span>. You&apos;ve landed on the part before that.
                </p>
            </div>

            {recent.length > 0 && (
                <>
                    <h3 className="sec-h">Where you&apos;ve booked before</h3>
                    {recent.map((s) => (
                        <button key={s} type="button" className="card card-tap recent-row" onClick={() => router.push(`/b/${s}`)}>
                            <span className="recent-name">{s.replace(/-/g, " ")}</span>
                            <Icon d={PATHS.chevron} size={20} style={{ color: "var(--faint)" }} />
                        </button>
                    ))}
                </>
            )}

            <h3 className="sec-h">Two ways to get there</h3>
            <div className="card stack" style={{ gap: 16 }}>
                <div className="way">
                    <span className="way-n">1</span>
                    <div>
                        <strong>Scan the code at the counter</strong>
                        <p className="small muted" style={{ marginTop: 3 }}>
                            Most canteens print theirs on a poster by the till. Your phone&apos;s camera opens it — nothing to install.
                        </p>
                    </div>
                </div>
                <div className="way">
                    <span className="way-n">2</span>
                    <div style={{ flex: 1 }}>
                        <strong>Type the name under the code</strong>
                        <p className="small muted" style={{ marginTop: 3 }}>The poster prints it below the QR. Enter it here, or paste the whole link if somebody sent you one.</p>
                        <form onSubmit={go} style={{ marginTop: 10 }}>
                            <input className="input" placeholder="e.g. sunrise-kitchen" autoCapitalize="none" autoCorrect="off" spellCheck="false"
                                value={code} onChange={(e) => setCode(e.target.value)} />
                            <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={!slug}>Open booking page</button>
                            {slug && slug !== code.trim().toLowerCase() && <span className="hint">Opening <span className="mono">{slug}</span></span>}
                        </form>
                    </div>
                </div>
            </div>

            <p className="small muted center" style={{ marginTop: 4 }}>No account, no app, no password — booking takes a name and a mobile number.</p>
            <p className="powered">Powered by <strong>{BRAND.company}</strong> {BRAND.shortName}</p>
        </div>
    );
}
