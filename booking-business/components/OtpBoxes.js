"use client";
// components/OtpBoxes.js — one box per digit. Auto-advances on typing,
// backspace steps back, and pasting a full code fills every box at once.
// Four digits here (the emailed reset code); the length is a prop.
import { useRef } from "react";

export default function OtpBoxes({ value, onChange, length = 4, disabled = false }) {
    const refs = useRef([]);

    const setDigit = (i, d) => {
        const chars = value.split("");
        while (chars.length <= i) chars.push("");
        chars[i] = d;
        onChange(chars.join("").replace(/\s+/g, ""));
    };

    const handleChange = (i, e) => {
        const raw = e.target.value.replace(/\D/g, "");
        if (!raw) { setDigit(i, ""); return; }
        if (raw.length > 1) {
            onChange(raw.slice(0, length));
            refs.current[Math.min(raw.length, length) - 1]?.focus();
            return;
        }
        setDigit(i, raw);
        if (i < length - 1) refs.current[i + 1]?.focus();
    };

    const handleKeyDown = (i, e) => {
        if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
    };

    return (
        <div className="otp-row">
            {Array.from({ length }).map((_, i) => (
                <input
                    key={i}
                    ref={(el) => (refs.current[i] = el)}
                    className="input otp-box"
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    // Not 1: the browser would truncate a pasted code before
                    // handleChange could see it, making the paste branch unreachable.
                    maxLength={length}
                    autoFocus={i === 0}
                    disabled={disabled}
                    value={value[i] || ""}
                    onChange={(e) => handleChange(i, e)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    aria-label={`Digit ${i + 1}`}
                />
            ))}
        </div>
    );
}
