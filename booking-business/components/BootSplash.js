"use client";
// components/BootSplash.js — the branded screen shown while the dashboard
// boots. Same animation and timing as the Chefo owner dashboard: one Chefo
// loading experience, not two. Replaces a bare spinner, which on a cold
// start reads as "something is broken". Never blocks — whatever is behind it
// renders the moment the session resolves.
import Image from "next/image";

export default function BootSplash({ label = "Getting things ready" }) {
    return (
        <div className="boot" role="status" aria-label={label}>
            <style>{`
        .boot {
          position: fixed; inset: 0; z-index: 90;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 18px; background: var(--paper);
          animation: boot-in 220ms var(--ease, ease) both;
        }
        .boot-art { position: relative; width: 132px; height: 132px; display: grid; place-items: center; }
        .boot-road {
          position: absolute; bottom: 6px; left: 50%;
          height: 2px; width: 0; border-radius: 2px;
          background: linear-gradient(90deg, transparent, var(--border-strong), transparent);
          transform: translateX(-50%);
          animation: boot-road 520ms 120ms var(--ease, ease) forwards;
        }
        .boot-logo { border-radius: 50%; animation: boot-ride 760ms cubic-bezier(0.22, 1.2, 0.36, 1) both; }
        .boot-logo-idle { animation: boot-bob 1.6s 800ms ease-in-out infinite; }
        .boot-word {
          font-family: var(--font-display), sans-serif;
          font-weight: 700; font-size: 19px; letter-spacing: -0.01em; color: var(--ink);
          animation: boot-word 420ms 520ms var(--ease, ease) both;
        }
        .boot-word em { color: var(--basil); font-style: normal; }
        .boot-sub { font-size: 12.5px; color: var(--faint); animation: boot-word 420ms 680ms var(--ease, ease) both; }

        @keyframes boot-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes boot-road { from { width: 0; } to { width: 108px; } }
        @keyframes boot-ride {
          0%   { opacity: 0; transform: translateX(-140px) rotate(-8deg); }
          60%  { opacity: 1; }
          100% { opacity: 1; transform: translateX(0) rotate(0deg); }
        }
        @keyframes boot-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes boot-word { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

        @media (prefers-reduced-motion: reduce) {
          .boot, .boot-road, .boot-logo, .boot-logo-idle, .boot-word, .boot-sub { animation: none !important; }
          .boot-road { width: 108px; }
        }
      `}</style>

            <div className="boot-art">
                <span className="boot-road" aria-hidden="true" />
                <span className="boot-logo-idle">
                    <Image className="boot-logo" src="/chefo-mark.png" alt="" width={104} height={104} priority />
                </span>
            </div>
            <span className="boot-word">Chef<em>o</em> Booking</span>
            <span className="boot-sub">{label}</span>
        </div>
    );
}
