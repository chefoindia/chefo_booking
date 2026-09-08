"use client";
// Business configuration — the section that stops this product being hardcoded
// to one canteen's habits.
//
// Meal services and their cutoffs, meal variants, and the booking rules. All of
// it is data, which is why an operator can add "Snacks" or "Jain" here and have
// it appear on the customer form immediately, with no release.
import { useCallback, useEffect, useState } from "react";
import { get, patch, post, del } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import { formatTime } from "@/lib/format";
import { Field, Input, Select, Textarea, Check } from "@/components/Field";
import Modal from "@/components/Modal";
import Empty from "@/components/Empty";

const TABS = [
    ["meals", "Meal services"],
    ["variants", "Meal options"],
    ["rules", "Booking rules"],
    ["profile", "Business profile"],
];

export default function SettingsPage() {
    const access = useAccess();
    const toast = useToast();
    const [tab, setTab] = useState("meals");
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);

    const canEdit = access.can("config.edit");

    const load = useCallback(async () => {
        setLoading(true);
        try { setConfig(await get("/api/config")); }
        catch (e) { toast("error", "Couldn't load settings", e.message); }
        finally { setLoading(false); }
    }, [toast]);

    useEffect(() => { load(); }, [load]);

    if (loading) return <div className="sk" style={{ height: 240 }} />;
    if (!config) return null;

    return (
        <div>
            <div className="page-head">
                <h1 className="page-title">Settings</h1>
                <p className="page-sub">
                    Meal services, the options customers choose from, and how bookings behave.
                </p>
            </div>

            <div className="row wrap" style={{ marginBottom: 14 }}>
                {TABS.map(([k, label]) => (
                    <button key={k} className={`btn btn-sm ${tab === k ? "btn-primary" : ""}`}
                        onClick={() => setTab(k)}>{label}</button>
                ))}
            </div>

            {tab === "meals" && <MealServices config={config} canEdit={canEdit} reload={load} />}
            {tab === "variants" && <Variants config={config} canEdit={canEdit} reload={load} />}
            {tab === "rules" && <Rules config={config} canEdit={canEdit} reload={load} />}
            {tab === "profile" && <Profile config={config} canEdit={canEdit} reload={load} />}
        </div>
    );
}

/* ------------------------------------------------------------------ */
function MealServices({ config, canEdit, reload }) {
    const toast = useToast();
    const [editing, setEditing] = useState(null);

    const save = async (form) => {
        const body = {
            name: form.name,
            startTime: form.startTime,
            endTime: form.endTime,
            cutoffTime: form.cutoffTime,
            cutoffPreviousDay: form.cutoffPreviousDay,
            active: form.active,
            customerBookable: form.customerBookable,
        };
        try {
            if (form._id) await patch(`/api/config/meal-types/${form._id}`, body);
            else await post("/api/config/meal-types", body);
            toast("success", "Saved", `"${form.name}" is set up.`);
            setEditing(null);
            reload();
        } catch (e) {
            toast("error", "Couldn't save", e.message);
        }
    };

    return (
        <>
            <div className="card">
                <div className="card-pad row-between">
                    <div>
                        <strong>Meal services</strong>
                        <p className="small muted" style={{ marginTop: 2 }}>
                            Each has its own cutoff. Before it, bookings confirm automatically;
                            after it, they wait for your approval.
                        </p>
                    </div>
                    {canEdit && (
                        <button className="btn btn-primary btn-sm"
                            onClick={() => setEditing({
                                name: "", startTime: "", endTime: "", cutoffTime: "",
                                cutoffPreviousDay: false, active: true, customerBookable: true,
                            })}>
                            + Add
                        </button>
                    )}
                </div>

                {!config.mealTypes.length ? (
                    <Empty title="No meal services yet"
                        note="Add the meals this business serves — breakfast, lunch, a night-shift meal, anything." />
                ) : (
                    <div className="table-wrap">
                        <table className="tbl">
                            <thead>
                                <tr><th>Name</th><th>Served</th><th>Cutoff</th><th>Status</th><th></th></tr>
                            </thead>
                            <tbody>
                                {config.mealTypes.map((m) => (
                                    <tr key={m._id}>
                                        <td><strong>{m.name}</strong></td>
                                        <td className="small muted">
                                            {m.startTime && m.endTime
                                                ? `${formatTime(m.startTime)} – ${formatTime(m.endTime)}`
                                                : "—"}
                                        </td>
                                        <td className="small">
                                            {m.cutoffTime ? (
                                                <>
                                                    {formatTime(m.cutoffTime)}
                                                    {m.cutoffPreviousDay && (
                                                        <span className="xsmall faint"> (day before)</span>
                                                    )}
                                                </>
                                            ) : <span className="badge badge-blue">No cutoff</span>}
                                        </td>
                                        <td>
                                            <div className="row" style={{ gap: 5 }}>
                                                <span className={`badge ${m.active ? "badge-green" : "badge-gray"}`}>
                                                    {m.active ? "Active" : "Inactive"}
                                                </span>
                                                {m.active && !m.customerBookable && (
                                                    <span className="badge badge-amber">Counter only</span>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            {canEdit && (
                                                <button className="btn btn-ghost btn-sm"
                                                    onClick={() => setEditing({ ...m })}>Edit</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {editing && <MealForm initial={editing} onClose={() => setEditing(null)} onSave={save} />}
        </>
    );
}

function MealForm({ initial, onClose, onSave }) {
    const [f, setF] = useState(initial);
    const [busy, setBusy] = useState(false);
    const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

    return (
        <Modal open onClose={onClose}
            title={initial._id ? `Edit ${initial.name}` : "New meal service"}
            footer={
                <>
                    <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className="btn btn-primary" disabled={busy || !f.name.trim()}
                        onClick={async () => { setBusy(true); await onSave(f); setBusy(false); }}>
                        {busy ? "Saving…" : "Save"}
                    </button>
                </>
            }
        >
            <div className="stack">
                <Field label="Name" hint="Whatever this business calls it — Lunch, Snacks, Night shift meal.">
                    <Input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
                </Field>

                <div className="grid-2">
                    <Field label="Served from"><Input type="time" value={f.startTime || ""}
                        onChange={(e) => set("startTime", e.target.value)} /></Field>
                    <Field label="Served until"><Input type="time" value={f.endTime || ""}
                        onChange={(e) => set("endTime", e.target.value)} /></Field>
                </div>

                <Field
                    label="Booking cutoff"
                    hint="Leave empty and this meal never closes — every booking confirms automatically."
                >
                    <Input type="time" value={f.cutoffTime || ""}
                        onChange={(e) => set("cutoffTime", e.target.value)} />
                </Field>

                <Check label="Cutoff falls on the day before"
                    checked={Boolean(f.cutoffPreviousDay)}
                    onChange={(e) => set("cutoffPreviousDay", e.target.checked)} />
                <p className="xsmall faint" style={{ marginTop: -4 }}>
                    For a kitchen that shops or preps the night before — tomorrow&apos;s breakfast
                    closes this evening.
                </p>

                <Check label="Active" checked={Boolean(f.active)}
                    onChange={(e) => set("active", e.target.checked)} />
                <Check label="Customers can book this online"
                    checked={Boolean(f.customerBookable)}
                    onChange={(e) => set("customerBookable", e.target.checked)} />
            </div>
        </Modal>
    );
}

/* ------------------------------------------------------------------ */
function Variants({ config, canEdit, reload }) {
    const toast = useToast();
    const [editing, setEditing] = useState(null);

    const save = async (form) => {
        const body = {
            name: form.name, description: form.description,
            price: Number(form.price) || 0, active: form.active,
        };
        try {
            if (form._id) await patch(`/api/config/variants/${form._id}`, body);
            else await post("/api/config/variants", body);
            toast("success", "Saved", `"${form.name}" is available.`);
            setEditing(null);
            reload();
        } catch (e) { toast("error", "Couldn't save", e.message); }
    };

    const deactivate = async (v) => {
        try {
            await del(`/api/config/variants/${v._id}`);
            toast("success", "Deactivated",
                `"${v.name}" has left the booking form. Existing bookings keep it.`);
            reload();
        } catch (e) { toast("error", "Couldn't deactivate", e.message); }
    };

    return (
        <>
            <div className="card">
                <div className="card-pad row-between">
                    <div>
                        <strong>Meal options</strong>
                        <p className="small muted" style={{ marginTop: 2 }}>
                            What a booking&apos;s quantity is split across — Veg, Non-Veg, Jain,
                            Thali A, whatever this business actually serves.
                        </p>
                    </div>
                    {canEdit && (
                        <button className="btn btn-primary btn-sm"
                            onClick={() => setEditing({ name: "", description: "", price: 0, active: true })}>
                            + Add
                        </button>
                    )}
                </div>

                {!config.variants.length ? (
                    <Empty title="No options yet"
                        note="Add at least one — customers choose quantities against these." />
                ) : (
                    <div className="table-wrap">
                        <table className="tbl">
                            <thead><tr><th>Name</th><th>Description</th><th className="num">Price</th><th>Status</th><th></th></tr></thead>
                            <tbody>
                                {config.variants.map((v) => (
                                    <tr key={v._id}>
                                        <td><strong>{v.name}</strong></td>
                                        <td className="small muted">{v.description || "—"}</td>
                                        <td className="num">{v.price ? `₹${v.price}` : "—"}</td>
                                        <td>
                                            <span className={`badge ${v.active ? "badge-green" : "badge-gray"}`}>
                                                {v.active ? "Active" : "Inactive"}
                                            </span>
                                        </td>
                                        <td>
                                            {canEdit && (
                                                <div className="row" style={{ gap: 4 }}>
                                                    <button className="btn btn-ghost btn-sm"
                                                        onClick={() => setEditing({ ...v })}>Edit</button>
                                                    {v.active && (
                                                        <button className="btn btn-ghost btn-sm"
                                                            onClick={() => deactivate(v)}>Deactivate</button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {editing && (
                <Modal open onClose={() => setEditing(null)}
                    title={editing._id ? `Edit ${editing.name}` : "New meal option"}
                    footer={
                        <>
                            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                            <button className="btn btn-primary" disabled={!editing.name.trim()}
                                onClick={() => save(editing)}>Save</button>
                        </>
                    }
                >
                    <div className="stack">
                        <Field label="Name" hint="Veg, Non-Veg, Jain, Egg, Thali A — anything.">
                            <Input value={editing.name} autoFocus
                                onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} />
                        </Field>
                        <Field label="Description (optional)" hint="A short hint shown under the option.">
                            <Input value={editing.description || ""}
                                onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))} />
                        </Field>
                        <Field label="Price (optional)"
                            hint="Leave at 0 unless you're recording amounts. Payment isn't handled here.">
                            <Input type="number" min="0" value={editing.price ?? 0}
                                onChange={(e) => setEditing((p) => ({ ...p, price: e.target.value }))} />
                        </Field>
                        <Check label="Active" checked={Boolean(editing.active)}
                            onChange={(e) => setEditing((p) => ({ ...p, active: e.target.checked }))} />
                    </div>
                </Modal>
            )}
        </>
    );
}

/* ------------------------------------------------------------------ */
function Rules({ config, canEdit, reload }) {
    const toast = useToast();
    const [r, setR] = useState(config.business.rules || {});
    const [busy, setBusy] = useState(false);
    const set = (k, v) => setR((p) => ({ ...p, [k]: v }));

    const save = async () => {
        setBusy(true);
        try {
            await patch("/api/config/business", { rules: r });
            toast("success", "Rules saved");
            reload();
        } catch (e) { toast("error", "Couldn't save", e.message); }
        finally { setBusy(false); }
    };

    return (
        <div className="card card-pad stack" style={{ maxWidth: 620 }}>
            <div>
                <strong>Booking rules</strong>
                <p className="small muted" style={{ marginTop: 2 }}>
                    What customers may do on their own. The cutoff behaviour itself isn&apos;t
                    configurable — after the cutoff, changes always come to you for approval.
                </p>
            </div>

            <div className="grid-2">
                <Field label="Book up to (days ahead)" hint="0 means today only.">
                    <Input type="number" min="0" max="365" value={r.maxDaysAhead ?? 14}
                        disabled={!canEdit}
                        onChange={(e) => set("maxDaysAhead", Number(e.target.value))} />
                </Field>
                <Field label="Max meals per booking" hint="A guard against a fat finger becoming 5,000 plates.">
                    <Input type="number" min="1" value={r.maxQuantityPerBooking ?? 500}
                        disabled={!canEdit}
                        onChange={(e) => set("maxQuantityPerBooking", Number(e.target.value))} />
                </Field>
            </div>

            <div className="stack-sm">
                <div className="num-label">Before the cutoff, customers may</div>
                <Check label="Change their own booking" disabled={!canEdit}
                    checked={r.allowCustomerEditBeforeCutoff !== false}
                    onChange={(e) => set("allowCustomerEditBeforeCutoff", e.target.checked)} />
                <Check label="Cancel their own booking" disabled={!canEdit}
                    checked={r.allowCustomerCancelBeforeCutoff !== false}
                    onChange={(e) => set("allowCustomerCancelBeforeCutoff", e.target.checked)} />
            </div>

            <div className="stack-sm">
                <div className="num-label">After the cutoff, customers may ask you to</div>
                <Check label="Change a confirmed booking" disabled={!canEdit}
                    checked={r.allowCustomerChangeRequestAfterCutoff !== false}
                    onChange={(e) => set("allowCustomerChangeRequestAfterCutoff", e.target.checked)} />
                <Check label="Cancel a confirmed booking" disabled={!canEdit}
                    checked={r.allowCustomerCancelRequestAfterCutoff !== false}
                    onChange={(e) => set("allowCustomerCancelRequestAfterCutoff", e.target.checked)} />
                <p className="xsmall faint">
                    Turning these off makes a confirmed booking final once the cutoff passes.
                    Requests still have to be approved by you either way.
                </p>
            </div>

            <div className="stack-sm">
                <div className="num-label">Ask customers for</div>
                <Check label="Organisation / site name" disabled={!canEdit}
                    checked={Boolean(r.requireOrganisation)}
                    onChange={(e) => set("requireOrganisation", e.target.checked)} />
                <Check label="Delivery location" disabled={!canEdit}
                    checked={Boolean(r.requireLocation)}
                    onChange={(e) => set("requireLocation", e.target.checked)} />
            </div>

            {canEdit && (
                <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}
                    disabled={busy} onClick={save}>
                    {busy ? "Saving…" : "Save rules"}
                </button>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
function Profile({ config, canEdit, reload }) {
    const toast = useToast();
    const [b, setB] = useState(config.business);
    const [busy, setBusy] = useState(false);
    const set = (k, v) => setB((p) => ({ ...p, [k]: v }));

    const customerUrl = `${process.env.NEXT_PUBLIC_CUSTOMER_URL || "http://localhost:4003"}/b/${b.slug}`;

    const save = async () => {
        setBusy(true);
        try {
            await patch("/api/config/business", {
                name: b.name, contactPhone: b.contactPhone, contactEmail: b.contactEmail,
                addressLine: b.addressLine, city: b.city, landmark: b.landmark,
                acceptingBookings: b.acceptingBookings, closedMessage: b.closedMessage,
            });
            toast("success", "Profile saved");
            reload();
        } catch (e) { toast("error", "Couldn't save", e.message); }
        finally { setBusy(false); }
    };

    return (
        <div className="card card-pad stack" style={{ maxWidth: 620 }}>
            <div>
                <strong>Business profile</strong>
                <p className="small muted" style={{ marginTop: 2 }}>
                    What customers see on your booking page.
                </p>
            </div>

            <div className="banner banner-info">
                <div className="small" style={{ marginBottom: 4 }}>Your booking page</div>
                <a className="mono" href={customerUrl} target="_blank" rel="noreferrer"
                    style={{ textDecoration: "underline", wordBreak: "break-all" }}>
                    {customerUrl}
                </a>
            </div>

            <Field label="Business name">
                <Input value={b.name || ""} disabled={!canEdit}
                    onChange={(e) => set("name", e.target.value)} />
            </Field>
            <div className="grid-2">
                <Field label="Contact phone">
                    <Input value={b.contactPhone || ""} disabled={!canEdit}
                        onChange={(e) => set("contactPhone", e.target.value)} />
                </Field>
                <Field label="Contact email">
                    <Input value={b.contactEmail || ""} disabled={!canEdit}
                        onChange={(e) => set("contactEmail", e.target.value)} />
                </Field>
            </div>
            <Field label="Address">
                <Input value={b.addressLine || ""} disabled={!canEdit}
                    onChange={(e) => set("addressLine", e.target.value)} />
            </Field>
            <div className="grid-2">
                <Field label="City">
                    <Input value={b.city || ""} disabled={!canEdit}
                        onChange={(e) => set("city", e.target.value)} />
                </Field>
                <Field label="Landmark">
                    <Input value={b.landmark || ""} disabled={!canEdit}
                        onChange={(e) => set("landmark", e.target.value)} />
                </Field>
            </div>

            <Check label="Accepting new bookings" disabled={!canEdit}
                checked={b.acceptingBookings !== false}
                onChange={(e) => set("acceptingBookings", e.target.checked)} />
            {b.acceptingBookings === false && (
                <Field label="Message shown to customers"
                    hint="Existing bookings are unaffected — this only stops new ones.">
                    <Textarea rows={2} value={b.closedMessage || ""} disabled={!canEdit}
                        onChange={(e) => set("closedMessage", e.target.value)} />
                </Field>
            )}

            {canEdit && (
                <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}
                    disabled={busy} onClick={save}>
                    {busy ? "Saving…" : "Save profile"}
                </button>
            )}
        </div>
    );
}
