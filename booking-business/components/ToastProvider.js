"use client";
import { createContext, useCallback, useContext, useState } from "react";

const Ctx = createContext(() => {});
export const useToast = () => useContext(Ctx);

export default function ToastProvider({ children }) {
    const [items, setItems] = useState([]);

    const toast = useCallback((kind, title, body) => {
        const id = Math.random().toString(36).slice(2);
        setItems((prev) => [...prev, { id, kind, title, body }]);
        // Errors linger: a failed approval is something the operator has to
        // actually read, not catch out of the corner of their eye.
        setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)),
            kind === "error" ? 6000 : 3500);
    }, []);

    return (
        <Ctx.Provider value={toast}>
            {children}
            <div className="toast-stack">
                {items.map((t) => (
                    <div key={t.id} className={`toast toast-${t.kind}`}>
                        <strong>{t.title}</strong>
                        {t.body && <span className="small">{t.body}</span>}
                    </div>
                ))}
            </div>
        </Ctx.Provider>
    );
}
