"use client";
// components/OutletsSection.js — Settings → Outlets. Create, edit, deactivate
// and reactivate the serving points of this business.
//
// Same shape as the meal-service section: cards, a drawer for the form, and
// every mutation behind the shared confirmation drawer (`ask` / `run`), so
// nothing here saves on a bare click. Deactivation is the only "delete":
// bookings reference outlets and the kitchen sheets of the past must keep
// reading correctly.
import { useCallback, useEffect, useState } from "react";
import { get, post, patch, del } from "@/lib/api";
import { Field, Input, Check } from "@/components/Field";
import Drawer from "@/components/Drawer";
import Empty from "@/components/Empty";
import { useAccess } from "@/app/dashboard/layout";

const emptyOutlet = () => ({ name: "", description: "", addressLine: "", contactPhone: "", active: true });

export default function OutletsSection({ canEdit, ask, run }) {
    const access = useAccess();
    const [data, setData] = useState(null);
    const [editing, setEditing] = useState(null);

    const load = useCallback(async () => {
        try { setData(await get("/api/outlets/manage")); }
        catch { setData({ outlets: [], unassignedBookings: 0 }); }
    }, []);
    useEffect(() => { load(); }, [load]);

    // The shell's selector must learn about a new or renamed outlet too.
    const after = async () => { await load(); await access.reload?.(); };

    const save = (form) => {
        const body = {
            name: form.name, description: form.description, addressLine: form.addressLine,
            contactPhone: form.contactPhone, active: form.active,
        };
        const isNew = !form.id;
        ask({
            title: isNew ? `Add ${form.name}?` : `Save ${form.name}?`,
            body: isNew
                ? (data?.outlets?.length
                    ? `${form.name} becomes an option on the customer booking page and at the counter.`
                    : `${form.name} will be this business's first outlet. From now on every new booking — from customers and at the counter — must name an outlet, and QR codes are only accepted at the outlet they were booked for. Bookings made before today are kept as they are.`)
                : `Bookings already made for ${form.name} keep the name they were booked under.`,
            label: isNew ? "Add outlet" : "Save changes",
            action: run(
                () => (isNew ? post("/api/outlets", body) : patch(`/api/outlets/${form.id}`, body)),
                "Saved", `${form.name} is set up.`, after
            ),
        });
        setEditing(null);
    };

    const deactivate = (o) => ask({
        title: `Deactivate ${o.name}?`,
        danger: true,
        body: `Customers can no longer choose ${o.name}, and the counter can't book it. Its ${o.bookingCount} existing booking${o.bookingCount === 1 ? "" : "s"} are kept, still count, and can still be served there. Staff assigned to it keep their assignment.`,
        label: "Deactivate",
        action: run(() => del(`/api/outlets/${o.id}`), "Deactivated", `${o.name} has left the booking form.`, after),
    });

    const reactivate = (o) => ask({
        title: `Reactivate ${o.name}?`,
        body: `${o.name} returns to the booking form and the counter.`,
        label: "Reactivate",
        action: run(() => patch(`/api/outlets/${o.id}`, { active: true }), "Reactivated", `${o.name} is bookable again.`, after),
    });

    const outlets = data?.outlets || [];

    return (
        <section id="sec-outlets" className="card card-pad sec-anchor">
            <div className="row-between wrap" style={{ marginBottom: 2 }}>
                <h2 style={{ fontSize: 16 }}>Outlets & sites</h2>
                {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing(emptyOutlet())}>+ Add outlet</button>}
            </div>
            <p className="why">
                The places this business serves from — a main cafeteria, a block, a guest house, a project site.
                Once you have any, every new booking belongs to exactly one, a booking&apos;s QR only works at its own
                outlet, and the outlet selector at the top of every page filters the dashboard to one of them.
            </p>

            {!data ? <div className="sk" style={{ height: 90 }} /> : !outlets.length ? (
                <Empty title="No outlets yet"
                    note="A single-site business doesn't need any — bookings work exactly as before. Add outlets only if you serve from more than one place."
                    icon="menu"
                    action={canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing(emptyOutlet())}>Add your first outlet</button>} />
            ) : (
                <div className="grid grid-2">
                    {outlets.map((o) => (
                        <div key={o.id} className="card card-pad" style={{ padding: 16, opacity: o.active ? 1 : 0.7 }}>
                            <div className="row-between" style={{ marginBottom: 8 }}>
                                <strong style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>{o.name}</strong>
                                <span className={`badge ${o.active ? "badge-green" : "badge-gray"}`}>{o.active ? "Active" : "Inactive"}</span>
                            </div>
                            <div className="stack-sm small">
                                {o.description && <div className="muted">{o.description}</div>}
                                {o.addressLine && <div className="row-between"><span className="muted">Address</span><span>{o.addressLine}</span></div>}
                                {o.contactPhone && <div className="row-between"><span className="muted">Phone</span><span className="mono">{o.contactPhone}</span></div>}
                                <div className="row-between"><span className="muted">Bookings</span><span>{o.bookingCount}</span></div>
                                <div className="row-between">
                                    <span className="muted">Assigned staff</span>
                                    <span>{o.staff?.length ? o.staff.map((s) => s.name).join(", ") : <span className="faint">None (canteen-wide staff cover it)</span>}</span>
                                </div>
                            </div>
                            {canEdit && (
                                <div className="row" style={{ marginTop: 12, gap: 6 }}>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing({ ...o })}>Edit</button>
                                    {o.active
                                        ? <button className="btn btn-ghost btn-sm" onClick={() => deactivate(o)}>Deactivate…</button>
                                        : <button className="btn btn-ghost btn-sm" onClick={() => reactivate(o)}>Reactivate…</button>}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {data?.unassignedBookings > 0 && outlets.length > 0 && (
                <div className="banner banner-info" style={{ marginTop: 14 }}>
                    <strong>{data.unassignedBookings} booking{data.unassignedBookings === 1 ? "" : "s"} predate your outlets.</strong>
                    <div style={{ marginTop: 4 }}>
                        They are kept exactly as they were and show under “Unassigned” on the overall dashboard. They are never
                        moved to an outlet automatically — an administrator can assign them deliberately with the migration script.
                    </div>
                </div>
            )}

            <Drawer open={Boolean(editing)} onClose={() => setEditing(null)}
                title={editing?.id ? `Edit ${editing.name}` : "New outlet"}
                footer={editing && (
                    <>
                        <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                        <button className="btn btn-primary" disabled={!editing.name.trim()} onClick={() => save(editing)}>
                            {editing.id ? "Save…" : "Add…"}
                        </button>
                    </>
                )}>
                {editing && (
                    <div>
                        <Field label="Name" hint="What staff and customers call it — Main Cafeteria, Block A, Guest House.">
                            <Input value={editing.name} autoFocus maxLength={60}
                                onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} />
                        </Field>
                        <Field label="Description (optional)" hint="Shown under the name on the customer's outlet picker.">
                            <Input value={editing.description || ""} maxLength={160}
                                onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))} />
                        </Field>
                        <Field label="Address / location (optional)">
                            <Input value={editing.addressLine || ""} maxLength={200}
                                onChange={(e) => setEditing((p) => ({ ...p, addressLine: e.target.value }))} />
                        </Field>
                        <Field label="Contact phone (optional)">
                            <Input value={editing.contactPhone || ""} maxLength={20}
                                onChange={(e) => setEditing((p) => ({ ...p, contactPhone: e.target.value }))} />
                        </Field>
                        <Check label="Active — customers and the counter can book it"
                            checked={editing.active !== false}
                            onChange={(e) => setEditing((p) => ({ ...p, active: e.target.checked }))} />
                    </div>
                )}
            </Drawer>
        </section>
    );
}
