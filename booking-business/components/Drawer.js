"use client";
// components/Drawer.js — the single secondary surface of the product.
// Every flow that would otherwise be a popup renders here, sliding in from
// the right. Same component as the Chefo owner dashboard.
import { useEffect } from "react";
import { lockScroll } from "@/lib/scrollLock";

export default function Drawer({ open, onClose, title, children, footer, wide = false }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => e.key === "Escape" && onClose?.();
        document.addEventListener("keydown", onKey);
        const unlock = lockScroll();
        return () => {
            document.removeEventListener("keydown", onKey);
            unlock();
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <>
            <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
            <aside className={`drawer ${wide ? "drawer-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
                <div className="drawer-head">
                    <div className="drawer-title">{title}</div>
                    <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close panel">✕</button>
                </div>
                <div className="drawer-body">{children}</div>
                {footer && <div className="drawer-foot">{footer}</div>}
            </aside>
        </>
    );
}
