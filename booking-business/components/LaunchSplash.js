"use client";
// components/LaunchSplash.js — the branded intro that plays ONCE each time the
// app is cold-launched, then fades into whatever screen was loading behind it.
// Kept visually identical to the Chefo owner app's copy. It NEVER blocks: the
// real screen renders underneath immediately and is revealed when the intro
// finishes. Fully reduced under prefers-reduced-motion.
import { useEffect, useState } from "react";
import Image from "next/image";

const SEEN_KEY = "chefo-booking-launch-shown";

export default function LaunchSplash({ tagline = "Book meals, count plates" }) {
    const [phase, setPhase] = useState("show");

    useEffect(() => {
        let alreadyShown = false;
        try { alreadyShown = sessionStorage.getItem(SEEN_KEY) === "1"; } catch { /* private mode */ }
        if (alreadyShown) { setPhase("done"); return; }

        const reduced = typeof window !== "undefined"
            && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

        const HOLD = reduced ? 650 : 2100;
        const EXIT = reduced ? 320 : 560;

        const toOut = setTimeout(() => setPhase("out"), HOLD);
        const toDone = setTimeout(() => {
            setPhase("done");
            try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
        }, HOLD + EXIT);

        return () => { clearTimeout(toOut); clearTimeout(toDone); };
    }, []);

    if (phase === "done") return null;

    return (
        <div className={`launch ${phase === "out" ? "launch-out" : ""}`} role="status" aria-label="Chefo Booking">
            <style>{`
        .launch {
          position: fixed; inset: 0; z-index: 9999; overflow: hidden;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: radial-gradient(120% 90% at 50% 38%, #ffffff 0%, var(--paper) 46%, #eef1ec 100%);
          animation: launch-in 300ms var(--ease, ease) both;
        }
        .launch-out { animation: launch-out 560ms var(--ease, ease) forwards; pointer-events: none; }

        .launch-stage { position: relative; width: 190px; height: 170px; display: grid; place-items: center; }
        .launch-halo {
          position: absolute; width: 150px; height: 150px; border-radius: 50%;
          background: radial-gradient(circle, rgba(32,110,78,.16) 0%, rgba(32,110,78,0) 62%);
          animation: launch-halo 1.5s .2s var(--ease, ease) both;
        }
        .launch-ring {
          position: absolute; width: 120px; height: 120px; border-radius: 50%;
          border: 2px solid rgba(32,110,78,.22);
          animation: launch-ring 1.4s .25s var(--ease, ease) both;
        }
        .launch-road {
          position: absolute; bottom: 20px; left: 50%; height: 3px; width: 0; border-radius: 3px;
          transform: translateX(-50%);
          background: linear-gradient(90deg, transparent, var(--border-strong) 22%, var(--border-strong) 78%, transparent);
          animation: launch-road .6s .35s var(--ease, ease) forwards;
        }
        .launch-mark {
          position: relative; width: 118px; height: 118px; will-change: transform;
          animation: launch-pop .55s .12s cubic-bezier(0.34,1.56,0.64,1) both,
                     launch-bob 2.4s .9s ease-in-out infinite;
        }
        .launch-mark img { filter: drop-shadow(0 10px 16px rgba(28,37,32,.14)); }
        .launch-dash { position: absolute; height: 3px; border-radius: 3px; opacity: 0; }
        .launch-dash.d1 { width: 26px; top: 52%; left: -6px; background: #c8871e; animation: launch-dash .5s .62s ease-out; }
        .launch-dash.d2 { width: 18px; top: 62%; left: 2px;  background: var(--basil); animation: launch-dash .5s .70s ease-out; }
        .launch-dash.d3 { width: 14px; top: 44%; left: 0;    background: var(--border-strong); animation: launch-dash .5s .78s ease-out; }
        .launch-steam { position: absolute; width: 5px; border-radius: 3px; opacity: 0;
          background: linear-gradient(to top, rgba(32,110,78,0), rgba(32,110,78,.34)); }
        .launch-steam.s1 { top: 34px; left: 52px; height: 22px; animation: launch-steam 1.8s .9s  ease-in-out infinite; }
        .launch-steam.s2 { top: 30px; left: 62px; height: 26px; animation: launch-steam 1.8s 1.15s ease-in-out infinite; }
        .launch-steam.s3 { top: 36px; left: 72px; height: 18px; animation: launch-steam 1.8s 1.35s ease-in-out infinite; }

        .launch-word {
          margin-top: 22px; font-family: var(--font-display), sans-serif;
          font-weight: 800; font-size: 30px; letter-spacing: -0.02em; color: var(--ink);
          opacity: 0; animation: launch-rise .55s .95s var(--ease, ease) both;
        }
        .launch-word em { color: var(--basil); font-style: normal; }
        .launch-word small { font-size: 16px; font-weight: 600; color: var(--slate); margin-left: 8px; letter-spacing: 0; }
        .launch-tag {
          margin-top: 7px; font-size: 12.5px; letter-spacing: .14em; text-transform: uppercase;
          color: var(--faint); font-weight: 600; opacity: 0;
          animation: launch-rise .55s 1.25s var(--ease, ease) both;
        }
        .launch-dots { position: absolute; bottom: 46px; display: flex; gap: 7px; opacity: 0;
          animation: launch-dots-in .4s 1.5s var(--ease, ease) both; }
        .launch-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--basil); display: block;
          animation: launch-dot 1.1s 1.6s ease-in-out infinite; }
        .launch-dots i:nth-child(2) { animation-delay: 1.72s; }
        .launch-dots i:nth-child(3) { animation-delay: 1.84s; }

        @keyframes launch-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes launch-out { to { opacity: 0; transform: scale(1.06); visibility: hidden; } }
        @keyframes launch-halo { 0% { transform: scale(.5); opacity: 0; } 35% { opacity: 1; } 100% { transform: scale(1.35); opacity: 0; } }
        @keyframes launch-ring { 0% { transform: scale(.6); opacity: 0; } 40% { opacity: .9; } 100% { transform: scale(1.5); opacity: 0; } }
        @keyframes launch-road { from { width: 0; } to { width: 150px; } }
        @keyframes launch-pop {
          0%   { opacity: 0; transform: translateX(-14px) scale(.72) rotate(-6deg); }
          60%  { opacity: 1; }
          100% { opacity: 1; transform: translateX(0) scale(1) rotate(0); }
        }
        @keyframes launch-bob {
          0%, 100% { transform: translateY(0); }
          25% { transform: translateY(-5px); }
          50% { transform: translateY(0); }
          58% { transform: translateX(5px); }
          66% { transform: translateX(0); }
        }
        @keyframes launch-dash { 0% { opacity: 0; transform: translateX(10px) scaleX(.4); } 40% { opacity: .85; } 100% { opacity: 0; transform: translateX(-42px) scaleX(1); } }
        @keyframes launch-steam { 0% { opacity: 0; transform: translateY(4px) scaleY(.7); } 30% { opacity: .7; } 100% { opacity: 0; transform: translateY(-16px) scaleY(1.1); } }
        @keyframes launch-rise { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: none; } }
        @keyframes launch-dots-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes launch-dot { 0%, 100% { transform: translateY(0); opacity: .4; } 50% { transform: translateY(-5px); opacity: 1; } }

        @media (prefers-reduced-motion: reduce) {
          .launch, .launch * { animation: none !important; opacity: 1 !important; }
          .launch-road { width: 150px; }
          .launch-out { animation: launch-out-rm 320ms ease forwards; }
          @keyframes launch-out-rm { to { opacity: 0; visibility: hidden; } }
        }
      `}</style>

            <div className="launch-stage" aria-hidden="true">
                <span className="launch-halo" />
                <span className="launch-ring" />
                <span className="launch-road" />
                <span className="launch-dash d1" />
                <span className="launch-dash d2" />
                <span className="launch-dash d3" />
                <span className="launch-steam s1" />
                <span className="launch-steam s2" />
                <span className="launch-steam s3" />
                <span className="launch-mark">
                    <Image src="/chefo-mark.png" alt="" width={118} height={118} priority />
                </span>
            </div>
            <div className="launch-word">Chef<em>o</em><small>Booking</small></div>
            <div className="launch-tag">{tagline}</div>
            <div className="launch-dots" aria-hidden="true"><i /><i /><i /></div>
        </div>
    );
}
