"use client";
// Profile — who this phone books as, and the optional account.
//
// The account lives HERE, one tab away from the booking form, and not on some
// separate page a customer has to be sent to. That is the whole point of it:
// somebody who has just booked lunch and is offered "keep these safe" should be
// two taps from doing it, in the same app, with the name and number they typed
// a minute ago already filled in.
//
// It is still an offer and never a gate. Booking works exactly the same without
// it; what an account buys is stated plainly — the bookings stop living in one
// browser — rather than dressed up as "create an account".
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { post } from "@/lib/api";
import { prettyPhone } from "@/lib/format";
import { readMe, writeMe, readLedger } from "@/lib/ledger";
import { useBooking } from "@/components/BookingShell";
import AccountSheet from "@/components/AccountSheet";
import { BRAND } from "@/lib/brand";

export default function ProfileTab() {
    const { slug } = useParams();
    const { biz, account, setAccount, refreshAccount } = useBooking();

    const [me, setMe] = useState({});
    const [saved, setSaved] = useState(0);
    const [sheet, setSheet] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");

    useEffect(() => {
        setMe(readMe() || {});
        setSaved((readLedger(slug) || []).length);
    }, [slug]);

    const party = account.party;
    const signedIn = account.signedIn;

    const saveMe = (patch) => {
        const next = writeMe(patch);
        setMe(next);
    };

    const signOut = async () => {
        setBusy(true);
        try {
            await post(`/api/public/business/${slug}/account/logout`, {});
        } catch { /* the cookie is gone either way as far as this page cares */ }
        setAccount({ checked: true, signedIn: false, party: null });
        setNotice("Signed out on this device. Your bookings are safe — sign in again with the same number any time.");
        setBusy(false);
    };

    return (
        <>
            {notice && <div className="notice notice-ok" style={{ marginBottom: 12 }}>{notice}</div>}

            {/* ---- the account ---- */}
            <h2 className="sec-h">Your account</h2>

            {!account.checked ? (
                <div className="sk" style={{ height: 120 }} />
            ) : signedIn ? (
                <div className="card">
                    <div className="row" style={{ gap: 12 }}>
                        <span className="app-topbar-mark" style={{ width: 42, height: 42, fontSize: 17 }}>
                            {(party?.name || "?").charAt(0).toUpperCase()}
                        </span>
                        <div style={{ minWidth: 0 }}>
                            <strong style={{ fontSize: 16 }}>{party?.name || "Signed in"}</strong>
                            <div className="xsmall faint">{prettyPhone(party?.phone)}</div>
                        </div>
                    </div>
                    <div className="notice notice-ok" style={{ marginTop: 12 }}>
                        Your bookings at {biz?.name || "this canteen"} are kept with this number. Open this
                        link on any phone, sign in with the same number, and they&apos;re all there.
                    </div>
                    <div className="btn-row" style={{ marginTop: 12 }}>
                        <Link href={`/b/${slug}/bookings`} className="btn btn-sm">My bookings</Link>
                        <button className="btn btn-sm" onClick={signOut} disabled={busy}>
                            {busy ? "Signing out…" : "Sign out"}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="card">
                    <strong style={{ fontSize: 16 }}>Keep your bookings, on any phone</strong>
                    <p className="small muted" style={{ marginTop: 6 }}>
                        Right now {saved > 0
                            ? `your ${saved} booking${saved === 1 ? " lives" : "s live"}`
                            : "your bookings live"} in this browser only — a new phone or a
                        cleared browser loses the shortcut to them.
                        Confirm your mobile number once and they follow you everywhere.
                    </p>
                    <ul className="plain-list">
                        <li>Just your name and your number. No password, ever.</li>
                        <li>One 6-digit code by SMS to check the number is yours.</li>
                        <li>You stay signed in — you won&apos;t be asked again.</li>
                    </ul>
                    <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setSheet(true)}>
                        Create my account
                    </button>
                    <p className="hint center" style={{ marginTop: 8 }}>
                        Booking works perfectly well without this.
                    </p>
                </div>
            )}

            {/* ---- what this phone fills in for you ---- */}
            <h2 className="sec-h">Booking details</h2>
            <div className="card">
                <p className="small muted" style={{ marginBottom: 11 }}>
                    Filled into the booking form for you, so you don&apos;t retype it every time.
                    Kept on this phone.
                </p>
                <div className="stack-sm">
                    <div>
                        <label className="label">Name</label>
                        <input className="input" placeholder="Your name" autoComplete="name"
                            value={me.name || ""}
                            onChange={(e) => saveMe({ name: e.target.value })} />
                    </div>
                    <div>
                        <label className="label">Mobile number</label>
                        <div className="row" style={{ gap: 8 }}>
                            <span className="input" style={{ width: 62, textAlign: "center", background: "var(--paper)", flexShrink: 0 }}>+91</span>
                            <input className="input" placeholder="Mobile number" inputMode="numeric" maxLength={10}
                                autoComplete="tel-national" value={me.phone || ""}
                                onChange={(e) => saveMe({ phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
                        </div>
                        <span className="hint">
                            This is how a booking is found and changed later — it is not a login.
                        </span>
                    </div>
                    <div>
                        <label className="label">Organisation / site (optional)</label>
                        <input className="input" placeholder="Where you're from"
                            value={me.organisation || ""}
                            onChange={(e) => saveMe({ organisation: e.target.value })} />
                    </div>
                </div>
            </div>

            {/* ---- the canteen ---- */}
            {biz && (
                <>
                    <h2 className="sec-h">This canteen</h2>
                    <div className="card">
                        <strong>{biz.name}</strong>
                        {[biz.addressLine, biz.landmark, biz.city].filter(Boolean).length > 0 && (
                            <p className="small muted" style={{ marginTop: 4 }}>
                                {[biz.addressLine, biz.landmark, biz.city].filter(Boolean).join(", ")}
                            </p>
                        )}
                        {biz.contactPhone && (
                            <p className="small" style={{ marginTop: 8 }}>
                                <a className="link" href={`tel:${biz.contactPhone}`}>{biz.contactPhone}</a>
                            </p>
                        )}
                        <p className="xsmall faint" style={{ marginTop: 10 }}>
                            Bookings open up to {biz.rules?.maxDaysAhead ?? 14} day
                            {(biz.rules?.maxDaysAhead ?? 14) === 1 ? "" : "s"} ahead.
                        </p>
                    </div>
                </>
            )}

            <p className="powered">Powered by <strong>{BRAND.company}</strong> {BRAND.shortName}</p>

            {sheet && (
                <AccountSheet
                    slug={slug}
                    onClose={() => setSheet(false)}
                    onDone={async (res) => {
                        setSheet(false);
                        setAccount({ checked: true, signedIn: true, party: res?.party || null });
                        setNotice("Done. Your bookings will be here whichever device you use.");
                        // Re-asks the server rather than trusting the response
                        // shape, so the rest of the app sees exactly what a
                        // fresh page load would see.
                        await refreshAccount();
                    }}
                />
            )}

            <style>{`
              .plain-list { margin: 10px 0 0; padding-left: 18px; font-size: 13px; color: var(--slate); line-height: 1.7; }
            `}</style>
        </>
    );
}
