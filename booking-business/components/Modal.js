"use client";
// components/Modal.js — centred, rounded dialog box.
//
// The app's default secondary surface is the right-side <Drawer>. This is the
// alternative for flows that read better as a focused box in the middle of
// the screen — a decision ("Accept this request?"), a role editor. Below
// 560px it grows to fill the width and pins to the bottom of the viewport,
// which is where a thumb actually reaches on a phone.
import { useEffect } from "react";
import { lockScroll } from "@/lib/scrollLock";

export default function Modal({ open, onClose, title, subtitle, children, footer, wide = false }) {
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
        <div className="mdl-backdrop" onMouseDown={onClose} role="presentation">
            <style>{`
        @keyframes mdl-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mdl-rise { from { opacity: 0; transform: translateY(12px) scale(.99) } to { opacity: 1; transform: none } }

        .mdl-backdrop {
          position: fixed; inset: 0; z-index: 130;
          display: flex; align-items: center; justify-content: center; padding: 20px;
          background: rgba(28, 37, 32, 0.44); backdrop-filter: blur(3px);
          animation: mdl-fade .16s ease both;
        }
        .mdl {
          display: flex; flex-direction: column;
          width: min(var(--mdl-w, 460px), 100%); max-height: calc(100vh - 40px);
          background: var(--card); border-radius: 16px;
          box-shadow: 0 24px 60px rgba(28,37,32,.26);
          animation: mdl-rise .22s cubic-bezier(.2,.8,.3,1) both;
          overflow: hidden;
        }
        .mdl-wide { --mdl-w: 640px; }

        .mdl-head {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
          padding: 18px 20px 14px; border-bottom: 1px solid var(--border);
        }
        .mdl-title { font-family: var(--font-display), sans-serif; font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
        .mdl-sub { font-size: 12.5px; color: var(--slate); margin: 3px 0 0; line-height: 1.5; }
        .mdl-x {
          flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px;
          border: 1px solid transparent; background: transparent; color: var(--slate);
          cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 15px;
        }
        .mdl-x:hover { background: var(--paper); color: var(--ink); }

        .mdl-body { padding: 16px 20px; overflow-y: auto; }
        .mdl-foot {
          display: flex; justify-content: flex-end; gap: 8px;
          padding: 14px 20px; border-top: 1px solid var(--border); background: var(--paper);
        }

        @media (max-width: 560px) {
          .mdl-backdrop { padding: 0; align-items: flex-end; }
          .mdl { width: 100%; max-height: 92vh; border-radius: 16px 16px 0 0; }
          .mdl-foot > .btn { flex: 1; justify-content: center; }
        }
      `}</style>

            {/* mousedown on the panel must not bubble to the backdrop, or dragging a
                selection out of an input would close the dialog mid-edit. */}
            <div
                className={`mdl ${wide ? "mdl-wide" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="mdl-head">
                    <div style={{ minWidth: 0 }}>
                        <div className="mdl-title">{title}</div>
                        {subtitle && <p className="mdl-sub">{subtitle}</p>}
                    </div>
                    <button className="mdl-x" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <div className="mdl-body">{children}</div>
                {footer && <div className="mdl-foot">{footer}</div>}
            </div>
        </div>
    );
}
