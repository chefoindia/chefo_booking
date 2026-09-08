"use client";
import { useEffect } from "react";

export default function Modal({ open, onClose, title, subtitle, children, footer, wide }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => e.key === "Escape" && onClose?.();
        document.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="mdl-back" onMouseDown={onClose}>
            {/* mousedown must not bubble, or dragging a selection out of an
                input would close the dialog mid-edit. */}
            <div className={`mdl ${wide ? "mdl-wide" : ""}`} role="dialog" aria-modal="true"
                onMouseDown={(e) => e.stopPropagation()}>
                <div className="mdl-head">
                    <div className="mdl-title">{title}</div>
                    {subtitle && <p className="small muted" style={{ marginTop: 3 }}>{subtitle}</p>}
                </div>
                <div className="mdl-body">{children}</div>
                {footer && <div className="mdl-foot">{footer}</div>}
            </div>
        </div>
    );
}
