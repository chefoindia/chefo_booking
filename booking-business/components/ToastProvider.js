"use client";
// components/ToastProvider.js — app-wide toasts (bottom-right, auto-dismiss).
import { createContext, useCallback, useContext, useState } from "react";

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export default function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const push = useCallback((kind, title, message) => {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t, { id, kind, title, message }]);
        // Errors linger: a failed approval is something the operator has to
        // actually read, not catch out of the corner of their eye.
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 4200);
    }, []);

    return (
        <ToastCtx.Provider value={push}>
            {children}
            <div className="toast-stack" role="status" aria-live="polite">
                {toasts.map((t) => (
                    <div key={t.id} className={`toast toast-${t.kind}`}>
                        {t.title && <strong>{t.title}</strong>}
                        {t.message}
                    </div>
                ))}
            </div>
        </ToastCtx.Provider>
    );
}
