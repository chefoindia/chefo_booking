"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { post } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { Field, Input } from "@/components/Field";

export default function LoginPage() {
    const router = useRouter();
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
            await post("/api/auth/login", { identifier: identifier.trim(), password });
            router.replace("/dashboard");
        } catch (err) {
            // The server deliberately does not distinguish "no such account"
            // from "wrong password", and neither does this screen — one is a
            // way to discover who holds an account.
            setError(err.message || "Could not sign you in.");
            setBusy(false);
        }
    };

    return (
        <div style={{
            minHeight: "100vh", display: "grid", placeItems: "center",
            padding: 20, background: "var(--paper)",
        }}>
            <div style={{ width: "min(400px, 100%)" }}>
                <div className="row" style={{ justifyContent: "center", marginBottom: 18 }}>
                    <span className="brand-mark" style={{ width: 34, height: 34, fontSize: 16 }}>B</span>
                    <div>
                        <div style={{ fontWeight: 800, fontSize: 17 }}>{BRAND.productName}</div>
                        <div className="brand-sub">Operations dashboard</div>
                    </div>
                </div>

                <form className="card card-pad stack" onSubmit={submit}>
                    <div>
                        <h1 style={{ fontSize: 17 }}>Sign in</h1>
                        <p className="small muted" style={{ marginTop: 3 }}>
                            Use the email address or mobile number your business registered.
                        </p>
                    </div>

                    {error && (
                        <div className="banner" style={{
                            background: "var(--brick-soft)", borderColor: "#f0c9be", color: "var(--brick)",
                        }}>
                            {error}
                        </div>
                    )}

                    <Field label="Email or mobile number">
                        <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                            autoComplete="username" autoFocus required />
                    </Field>

                    <Field label="Password">
                        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password" required />
                    </Field>

                    <button className="btn btn-primary btn-block" disabled={busy || !identifier || !password}>
                        {busy ? "Signing in…" : "Sign in"}
                    </button>

                    <p className="xsmall faint" style={{ textAlign: "center" }}>
                        Trouble signing in? Ask your business owner to reset your password.
                    </p>
                </form>
            </div>
        </div>
    );
}
