"use client";
// components/ClockTimeInput.js — analog clock-face time picker, replacing the
// browser's native <input type="time"> (an ugly scroll-wheel spinner in
// Chrome/Edge). Drop-in compatible: same "HH:MM" 24-hour string in and out.
// Ported from the Chefo owner dashboard.
//
// Tap a number for a quick snap, or drag anywhere on the ring for exact
// placement (drag resolves to the exact minute — cut-offs like 07:58 stay
// reachable). Hour selection auto-advances to minutes on release; nothing is
// applied until "Set time" is pressed, matching the app's confirm-before-
// commit pattern. An optional Clear button hands back "" — meaningful here,
// because an empty cutoff means "this meal never closes".
import { useEffect, useRef, useState } from "react";
import { lockScroll } from "@/lib/scrollLock";

const to12 = (hhmm) => {
    if (!hhmm) return { hour: 9, minute: 0, ampm: "AM" };
    const [h, m] = hhmm.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    let hour = h % 12;
    if (hour === 0) hour = 12;
    return { hour, minute: m || 0, ampm };
};

const to24 = (hour, minute, ampm) => {
    let h = hour % 12;
    if (ampm === "PM") h += 12;
    return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const displayLabel = (hhmm) => {
    if (!hhmm) return null;
    const { hour, minute, ampm } = to12(hhmm);
    return `${hour}:${String(minute).padStart(2, "0")} ${ampm}`;
};

function angleFromEvent(e, dialEl) {
    const r = dialEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
}

const HOUR_NUMS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTE_NUMS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const R = 92;

function ClockIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" />
        </svg>
    );
}

export default function ClockTimeInput({
    value, onChange, placeholder = "Not set", disabled, style, ariaLabel, isAllowed, clearable = false,
}) {
    const allows = typeof isAllowed === "function" ? isAllowed : () => true;
    const hourHasAnyValidMinute = (h24) => {
        for (let m = 0; m < 60; m++) if (allows(h24, m)) return true;
        return false;
    };
    const hour24 = (h12, ampm) => (ampm === "PM" ? (h12 % 12) + 12 : h12 % 12);
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState("hour");
    const [draft, setDraft] = useState(() => to12(value));
    const dialRef = useRef(null);
    const draggingRef = useRef(false);
    const appliedRef = useRef(false);
    const popRef = useRef(null);

    const clampDraft = (d) => {
        if (allows(hour24(d.hour, d.ampm), d.minute)) return d;
        for (const half of [d.ampm, d.ampm === "AM" ? "PM" : "AM"]) {
            for (const h of HOUR_NUMS) {
                for (let m = 0; m < 60; m++) {
                    if (allows(hour24(h, half), m)) return { hour: h, minute: m, ampm: half };
                }
            }
        }
        return d;
    };

    const openPicker = () => {
        if (disabled) return;
        setDraft(clampDraft(to12(value)));
        setMode("hour");
        setOpen(true);
    };
    const close = () => setOpen(false);
    const apply = () => {
        onChange?.(to24(draft.hour, draft.minute, draft.ampm));
        setOpen(false);
    };
    const clear = () => {
        onChange?.("");
        setOpen(false);
    };

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => e.key === "Escape" && close();
        const onOutside = (e) => { if (popRef.current && !popRef.current.contains(e.target)) close(); };
        document.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onOutside);
        const unlock = lockScroll();
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("mousedown", onOutside);
            unlock();
        };
    }, [open]);

    const valueFromAngle = (deg) => {
        if (mode === "hour") {
            let h = Math.round(deg / 30) % 12;
            if (h === 0) h = 12;
            return hourHasAnyValidMinute(hour24(h, draft.ampm)) ? { hour: h } : null;
        }
        const m = Math.round(deg / 6) % 60;
        return allows(hour24(draft.hour, draft.ampm), m) ? { minute: m } : null;
    };

    const handlePointer = (e) => {
        if (!dialRef.current) return;
        const deg = angleFromEvent(e, dialRef.current);
        const next = valueFromAngle(deg);
        if (!next) return;
        appliedRef.current = true;
        setDraft((d) => ({ ...d, ...next }));
    };

    const onDialPointerDown = (e) => {
        e.preventDefault();
        draggingRef.current = true;
        appliedRef.current = false;
        handlePointer(e);
    };

    useEffect(() => {
        if (!open) return;
        const onMove = (e) => { if (draggingRef.current) handlePointer(e); };
        const onUp = () => {
            if (draggingRef.current && appliedRef.current && mode === "hour") setMode("minute");
            draggingRef.current = false;
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, mode]);

    const nums = mode === "hour" ? HOUR_NUMS : MINUTE_NUMS;
    const activeIndex = mode === "hour"
        ? HOUR_NUMS.indexOf(draft.hour)
        : MINUTE_NUMS.indexOf((Math.round(draft.minute / 5) * 5) % 60);
    const handAngle = mode === "hour" ? (draft.hour % 12) * 30 : draft.minute * 6;

    return (
        <div className="cti" style={style}>
            <button
                type="button"
                className="input cti-trigger"
                onClick={openPicker}
                disabled={disabled}
                aria-label={ariaLabel || "Set time"}
                aria-haspopup="dialog"
                aria-expanded={open}
            >
                <ClockIcon />
                <span className={displayLabel(value) ? "" : "muted"}>{displayLabel(value) || placeholder}</span>
            </button>

            {open && (
                <>
                    <div className="cti-backdrop" aria-hidden="true" />
                    <div className="cti-pop" ref={popRef} role="dialog" aria-modal="true" aria-label="Set time">
                        <div className="cti-head">
                            <button type="button" className={`cti-seg ${mode === "hour" ? "on" : ""}`} onClick={() => setMode("hour")}>
                                {String(draft.hour).padStart(2, "0")}
                            </button>
                            <span className="cti-colon">:</span>
                            <button type="button" className={`cti-seg ${mode === "minute" ? "on" : ""}`} onClick={() => setMode("minute")}>
                                {String(draft.minute).padStart(2, "0")}
                            </button>
                            <div className="cti-ampm">
                                {["AM", "PM"].map((half) => {
                                    const enabled = HOUR_NUMS.some((h) => hourHasAnyValidMinute(hour24(h, half)));
                                    return (
                                        <button
                                            key={half}
                                            type="button"
                                            className={draft.ampm === half ? "on" : ""}
                                            disabled={!enabled}
                                            onClick={() => setDraft((d) => {
                                                const next = { ...d, ampm: half };
                                                if (!hourHasAnyValidMinute(hour24(d.hour, half))) {
                                                    const fallback = HOUR_NUMS.find((h) => hourHasAnyValidMinute(hour24(h, half)));
                                                    if (fallback) next.hour = fallback;
                                                }
                                                if (!allows(hour24(next.hour, half), next.minute)) next.minute = 0;
                                                return next;
                                            })}
                                        >
                                            {half}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <svg ref={dialRef} className="cti-dial" viewBox="0 0 220 220" onPointerDown={onDialPointerDown}>
                            <circle className="cti-face" cx="110" cy="110" r={R + 20} />
                            <line
                                className="cti-hand"
                                x1="110" y1="110"
                                x2={110 + (R - 4) * Math.sin((handAngle * Math.PI) / 180)}
                                y2={110 - (R - 4) * Math.cos((handAngle * Math.PI) / 180)}
                            />
                            <circle className="cti-hub" cx="110" cy="110" r="4" />
                            {nums.map((n, i) => {
                                const angle = (i * 30 * Math.PI) / 180;
                                const x = 110 + R * Math.sin(angle);
                                const y = 110 - R * Math.cos(angle);
                                const isActive = i === activeIndex;
                                const ok = mode === "hour"
                                    ? hourHasAnyValidMinute(hour24(n, draft.ampm))
                                    : allows(hour24(draft.hour, draft.ampm), n);
                                return (
                                    <g key={n} className={`cti-num ${isActive ? "on" : ""} ${ok ? "" : "off"}`}>
                                        <circle cx={x} cy={y} r="15" />
                                        <text x={x} y={y} dy="0.32em" textAnchor="middle">{String(n).padStart(2, "0")}</text>
                                    </g>
                                );
                            })}
                        </svg>

                        <div className="cti-foot">
                            {clearable && value && (
                                <button type="button" className="btn btn-ghost btn-sm" style={{ marginRight: "auto" }} onClick={clear}>Clear</button>
                            )}
                            <button type="button" className="btn btn-secondary btn-sm" onClick={close}>Cancel</button>
                            <button type="button" className="btn btn-primary btn-sm" onClick={apply}>Set time</button>
                        </div>
                    </div>
                </>
            )}

            <style>{`
        .cti { position: relative; display: block; width: 100%; }
        .cti-trigger { display: flex; align-items: center; gap: 8px; width: 100%; cursor: pointer; text-align: left; color: var(--ink); }
        .cti-trigger:disabled { cursor: not-allowed; opacity: 0.6; }
        .cti-backdrop { position: fixed; inset: 0; z-index: 120; background: rgba(28, 37, 32, 0.4); }
        .cti-pop {
          position: fixed; z-index: 121; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: min(300px, calc(100vw - 32px));
          background: var(--card); border-radius: var(--radius);
          box-shadow: var(--shadow-drawer);
          padding: 18px 18px 14px;
        }
        .cti-head { display: flex; align-items: center; justify-content: center; gap: 4px; margin-bottom: 16px; }
        .cti-seg {
          font-family: var(--font-display), sans-serif; font-size: 30px; font-weight: 700;
          background: var(--paper); border: 1px solid var(--border); border-radius: 8px;
          padding: 4px 8px; min-width: 56px; color: var(--slate); cursor: pointer;
        }
        .cti-seg.on { background: var(--basil-soft); border-color: var(--basil); color: var(--basil-dark); }
        .cti-colon { font-family: var(--font-display), sans-serif; font-size: 30px; font-weight: 700; color: var(--faint); }
        .cti-ampm { display: flex; flex-direction: column; gap: 3px; margin-left: 8px; }
        .cti-ampm button {
          font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px;
          border: 1px solid var(--border); background: var(--card); color: var(--slate); cursor: pointer;
        }
        .cti-ampm button.on { background: var(--basil); border-color: var(--basil); color: #fff; }
        .cti-ampm button:disabled { opacity: .38; cursor: not-allowed; }
        .cti-dial { width: 100%; height: auto; touch-action: none; user-select: none; cursor: pointer; }
        .cti-face { fill: var(--paper); stroke: var(--border); stroke-width: 1; }
        .cti-hand { stroke: var(--basil); stroke-width: 2.5; stroke-linecap: round; }
        .cti-hub { fill: var(--basil); }
        .cti-num circle { fill: transparent; }
        .cti-num text { font-size: 13px; font-weight: 600; fill: var(--ink); pointer-events: none; }
        .cti-num.on circle { fill: var(--basil); }
        .cti-num.on text { fill: #fff; }
        .cti-num.off text { fill: var(--border-strong); }
        .cti-num.off { pointer-events: none; }
        .cti-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
        @media (max-width: 420px) {
          .cti-pop { padding: 14px 14px 12px; }
          .cti-seg, .cti-colon { font-size: 26px; }
        }
      `}</style>
        </div>
    );
}
