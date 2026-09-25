"use client";
// components/Sheet.js — THE secondary surface of this app.
//
// Everything that would be a dialog elsewhere slides up from the bottom here.
// On a phone that keeps the controls under a thumb, keeps the screen behind it
// visible so nobody loses their place, and makes "close" a gesture rather than
// a back-button gamble. The booking form lives in one of these.
import { useEffect } from "react";
import { Icon, PATHS } from "@/components/Icons";

export default function Sheet({ open, onClose, title, subtitle, children, footer, headExtra = null }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
        document.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <>
            <div className="sheet-overlay" onClick={onClose} aria-hidden="true" />
            <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
                <div className="sheet-grabber" onClick={onClose} />
                <div className="sheet-head">
                    <div style={{ minWidth: 0 }}>
                        <div className="sheet-title">{title}</div>
                        {subtitle && <div className="sheet-sub">{subtitle}</div>}
                    </div>
                    <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                        {headExtra}
                        <button className="sheet-x" onClick={onClose} aria-label="Close">
                            <Icon d={PATHS.x} size={18} sw={2.2} />
                        </button>
                    </div>
                </div>
                <div className="sheet-body">{children}</div>
                {footer && <div className="sheet-foot">{footer}</div>}
            </div>
        </>
    );
}
