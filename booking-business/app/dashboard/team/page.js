"use client";
// Team and roles.
//
// A role is a named bag of permissions the owner assembles, so "Kitchen Lead"
// can be invented here without a release. The escalation guards live on the
// server — this screen only avoids offering what would be refused: permissions
// the current user could not grant are rendered locked rather than as
// checkboxes that would fail on save.
import { useCallback, useEffect, useState } from "react";
import { get, post, patch, del } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import { prettyPhone } from "@/lib/format";
import { Field, Input, Select, Check } from "@/components/Field";
import Modal from "@/components/Modal";
import Empty from "@/components/Empty";

export default function TeamPage() {
    const access = useAccess();
    const [tab, setTab] = useState(access.can("users.view") ? "people" : "roles");

    return (
        <div>
            <div className="page-head">
                <h1 className="page-title">Team</h1>
                <p className="page-sub">Who can sign into this dashboard, and what each of them may do.</p>
            </div>

            <div className="row" style={{ marginBottom: 14 }}>
                {access.can("users.view") && (
                    <button className={`btn btn-sm ${tab === "people" ? "btn-primary" : "btn-secondary"}`}
                        onClick={() => setTab("people")}>People</button>
                )}
                {access.can("roles.view") && (
                    <button className={`btn btn-sm ${tab === "roles" ? "btn-primary" : "btn-secondary"}`}
                        onClick={() => setTab("roles")}>Roles</button>
                )}
            </div>

            {tab === "people" ? <People /> : <Roles />}
        </div>
    );
}

/* ------------------------------------------------------------------ */
function People() {
    const access = useAccess();
    const toast = useToast();
    const [rows, setRows] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [t, r] = await Promise.all([
                get("/api/team"),
                access.can("roles.view") ? get("/api/roles") : Promise.resolve({ roles: [] }),
            ]);
            setRows(t.team || []);
            setRoles(r.roles || []);
        } catch (e) { toast("error", "Couldn't load the team", e.message); }
        finally { setLoading(false); }
    }, [access, toast]);

    useEffect(() => { load(); }, [load]);

    const save = async (form) => {
        const body = {
            name: form.name, email: form.email, phone: form.phone,
            roleId: form.roleId || null,
            // Empty = canteen-wide. The server refuses anything wider than
            // the person saving it holds.
            outletIds: form.outletIds || [],
            ...(form.password ? { password: form.password } : {}),
        };
        try {
            if (form.id) await patch(`/api/team/${form.id}`, body);
            else await post("/api/team", body);
            toast("success", "Saved", `${form.name} is set up.`);
            setEditing(null);
            load();
        } catch (e) { toast("error", e.status === 403 ? "Not allowed" : "Couldn't save", e.message); }
    };

    const toggle = async (m) => {
        try {
            await patch(`/api/team/${m.id}`, { isActive: !m.isActive });
            toast("success", m.isActive ? "Deactivated" : "Activated",
                m.isActive ? `${m.name} is blocked from their next action.` : `${m.name} can sign in again.`);
            load();
        } catch (e) { toast("error", "Couldn't update", e.message); }
    };

    return (
        <>
            <div className="card">
                <div className="card-pad row-between">
                    <strong>People</strong>
                    {access.can("users.create") && (
                        <button className="btn btn-primary btn-sm"
                            onClick={() => setEditing({
                                name: "", email: "", phone: "", roleId: "", password: "",
                                // A restricted admin can only hand out their own
                                // outlets, so start from those rather than "all".
                                outletIds: Array.isArray(access.outletScope) ? access.outletScope.map(String) : [],
                            })}>
                            + Add person
                        </button>
                    )}
                </div>

                {loading ? <div className="card-pad"><div className="sk" style={{ height: 120 }} /></div>
                    : !rows.length ? <Empty title="Nobody yet" />
                        : (
                            <div className="table-wrap">
                                <table className="tbl">
                                    <thead><tr><th>Name</th><th>Sign-in</th><th>Role</th>{access.outlets.length > 0 && <th>Outlets</th>}<th>Status</th><th></th></tr></thead>
                                    <tbody>
                                        {rows.map((m) => (
                                            <tr key={m.id}>
                                                <td>
                                                    <strong>{m.name}</strong>
                                                    {m.isOwner && <span className="badge badge-blue" style={{ marginLeft: 6 }}>Owner</span>}
                                                </td>
                                                <td className="small mono">
                                                    {m.email || prettyPhone(m.phone) || "—"}
                                                </td>
                                                <td>
                                                    {m.isOwner ? <span className="small muted">Unrestricted</span>
                                                        : m.roleName ? <span className="badge badge-gray">{m.roleName}</span>
                                                            : <span className="small faint">No role</span>}
                                                </td>
                                                {access.outlets.length > 0 && (
                                                    <td className="small">
                                                        {m.isOwner || !m.outletIds?.length
                                                            ? <span className="muted">All outlets</span>
                                                            : m.outletNames.join(", ")}
                                                    </td>
                                                )}
                                                <td>
                                                    <span className={`badge ${m.isActive ? "badge-green" : "badge-red"}`}>
                                                        {m.isActive ? "Active" : "Inactive"}
                                                    </span>
                                                </td>
                                                <td>
                                                    {!m.isOwner && access.can("users.edit") && (
                                                        <div className="row" style={{ gap: 4 }}>
                                                            <button className="btn btn-ghost btn-sm"
                                                                onClick={() => setEditing({ ...m, password: "" })}>Edit</button>
                                                            <button className="btn btn-ghost btn-sm"
                                                                onClick={() => toggle(m)}>
                                                                {m.isActive ? "Deactivate" : "Activate"}
                                                            </button>
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
                    title={editing.id ? `Edit ${editing.name}` : "Add person"}
                    footer={
                        <>
                            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                            <button className="btn btn-primary"
                                disabled={!editing.name?.trim() || (!editing.id && !editing.password)}
                                onClick={() => save(editing)}>Save</button>
                        </>
                    }
                >
                    <div className="stack">
                        <Field label="Name">
                            <Input value={editing.name} autoFocus
                                onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} />
                        </Field>
                        <div className="grid-2">
                            <Field label="Email">
                                <Input value={editing.email || ""}
                                    onChange={(e) => setEditing((p) => ({ ...p, email: e.target.value }))} />
                            </Field>
                            <Field label="Mobile">
                                <Input value={editing.phone || ""}
                                    onChange={(e) => setEditing((p) => ({ ...p, phone: e.target.value }))} />
                            </Field>
                        </div>
                        <p className="xsmall faint" style={{ marginTop: -6 }}>
                            Either one works as their sign-in. At least one is required.
                        </p>
                        <Field label={editing.id ? "New password (leave blank to keep)" : "Password"}
                            hint="At least 8 characters. Changing it signs them out everywhere.">
                            <Input type="password" value={editing.password || ""}
                                onChange={(e) => setEditing((p) => ({ ...p, password: e.target.value }))} />
                        </Field>
                        <Field label="Role" hint="Without a role they can sign in but see nothing.">
                            <Select value={editing.roleId || ""}
                                onChange={(e) => setEditing((p) => ({ ...p, roleId: e.target.value }))}>
                                <option value="">No role</option>
                                {roles.filter((r) => !r.archived).map((r) => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                            </Select>
                        </Field>

                        {/* WHERE they may act, on top of what the role lets
                            them do. Nothing ticked = the whole canteen. A
                            scanner ticked to Block A can only open and serve
                            Block A's codes, and sees only Block A's data. */}
                        {access.outlets.length > 0 && (
                            <OutletPicker
                                outlets={access.outlets}
                                scope={access.outletScope}
                                value={editing.outletIds || []}
                                onChange={(ids) => setEditing((p) => ({ ...p, outletIds: ids }))}
                            />
                        )}
                    </div>
                </Modal>
            )}
        </>
    );
}

function OutletPicker({ outlets, scope, value, onChange }) {
    const restricted = Array.isArray(scope);
    const has = (id) => value.some((v) => String(v) === String(id));
    const toggle = (id) => onChange(has(id) ? value.filter((v) => String(v) !== String(id)) : [...value, String(id)]);
    return (
        <div>
            <div className="num-label" style={{ marginBottom: 6 }}>Outlets</div>
            <div className="row wrap" style={{ gap: 6 }}>
                {!restricted && (
                    <label className="check-row" style={{
                        border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", fontSize: 12.5,
                        background: !value.length ? "var(--basil-soft)" : "var(--card)",
                        borderColor: !value.length ? "var(--basil)" : "var(--border)",
                    }}>
                        <input type="checkbox" checked={!value.length} onChange={() => onChange([])} />
                        All outlets
                    </label>
                )}
                {outlets.map((o) => (
                    <label key={o.id} className="check-row" style={{
                        border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", fontSize: 12.5,
                        background: has(o.id) ? "var(--basil-soft)" : "var(--card)",
                        borderColor: has(o.id) ? "var(--basil)" : "var(--border)",
                        opacity: o.active === false ? 0.7 : 1,
                    }}>
                        <input type="checkbox" checked={has(o.id)} onChange={() => toggle(o.id)} />
                        {o.name}{o.active === false ? " (inactive)" : ""}
                    </label>
                ))}
            </div>
            <span className="hint">
                {restricted
                    ? "You can only assign the outlets you work at yourself."
                    : "Tick specific outlets to limit this person to them — their scanner will only accept those outlets’ codes and their dashboard shows only those bookings. Nothing ticked means the whole canteen."}
            </span>
        </div>
    );
}

/* ------------------------------------------------------------------ */
function Roles() {
    const access = useAccess();
    const toast = useToast();
    const [roles, setRoles] = useState([]);
    const [catalogue, setCatalogue] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [r, c] = await Promise.all([get("/api/roles"), get("/api/roles/catalogue")]);
            setRoles(r.roles || []);
            setCatalogue(c.modules || []);
        } catch (e) { toast("error", "Couldn't load roles", e.message); }
        finally { setLoading(false); }
    }, [toast]);

    useEffect(() => { load(); }, [load]);

    const save = async (form) => {
        const body = { name: form.name, description: form.description, permissions: form.permissions };
        try {
            if (form.id) await patch(`/api/roles/${form.id}`, body);
            else await post("/api/roles", body);
            toast("success", "Saved", `"${form.name}" has ${form.permissions.length} permissions.`);
            setEditing(null);
            load();
        } catch (e) {
            const refused = e.data?.refused;
            toast("error", "Couldn't save",
                refused?.length ? `${e.message} (${refused.join(", ")})` : e.message);
        }
    };

    return (
        <>
            <div className="card">
                <div className="card-pad row-between">
                    <div>
                        <strong>Roles</strong>
                        <p className="small muted" style={{ marginTop: 2 }}>
                            Viewing never includes editing or approving unless you tick those too.
                        </p>
                    </div>
                    {access.can("roles.create") && (
                        <button className="btn btn-primary btn-sm"
                            onClick={() => setEditing({ name: "", description: "", permissions: [] })}>
                            + New role
                        </button>
                    )}
                </div>

                {loading ? <div className="card-pad"><div className="sk" style={{ height: 110 }} /></div>
                    : !roles.length ? (
                        <Empty title="No roles yet"
                            note="Create one like “Counter staff” or “Kitchen lead”, tick what it can do, then assign it." />
                    ) : (
                        <div className="stack-sm" style={{ padding: 14 }}>
                            {roles.filter((r) => !r.archived).map((r) => (
                                <div key={r.id} className="row-between"
                                    style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                                    <div>
                                        <strong>{r.name}</strong>
                                        {r.staffCount > 0 && (
                                            <span className="badge badge-blue" style={{ marginLeft: 6 }}>
                                                {r.staffCount} assigned
                                            </span>
                                        )}
                                        <div className="xsmall faint" style={{ marginTop: 3 }}>
                                            {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}
                                            {r.description ? ` · ${r.description}` : ""}
                                        </div>
                                    </div>
                                    {access.can("roles.edit") && (
                                        <button className="btn btn-ghost btn-sm"
                                            onClick={() => setEditing({ ...r, permissions: [...r.permissions] })}>
                                            Edit
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
            </div>

            {editing && (
                <RoleEditor initial={editing} catalogue={catalogue}
                    onClose={() => setEditing(null)} onSave={save} />
            )}
        </>
    );
}

function RoleEditor({ initial, catalogue, onClose, onSave }) {
    const [f, setF] = useState(initial);
    const [busy, setBusy] = useState(false);
    const has = (p) => f.permissions.includes(p);

    // Toggles ONE permission. Auto-ticking "view" when "edit" is chosen would
    // quietly grant access nobody asked for, and silently widen a role the
    // owner thought they were narrowing.
    const toggle = (p, grantable) => {
        if (!grantable) return;
        setF((prev) => ({
            ...prev,
            permissions: prev.permissions.includes(p)
                ? prev.permissions.filter((x) => x !== p)
                : [...prev.permissions, p],
        }));
    };

    return (
        <Modal open wide onClose={onClose}
            title={initial.id ? `Edit “${initial.name}”` : "New role"}
            subtitle={`${f.permissions.length} permission${f.permissions.length === 1 ? "" : "s"} selected`}
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
                <Field label="Role name" hint="Anything — “Counter staff”, “Kitchen lead”, “Accounts”.">
                    <Input value={f.name} autoFocus maxLength={40}
                        onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
                </Field>
                <Field label="Description (optional)">
                    <Input value={f.description || ""} maxLength={160}
                        onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} />
                </Field>

                <div>
                    <div className="num-label" style={{ marginBottom: 8 }}>What this role can do</div>
                    <div className="stack-sm">
                        {catalogue.map((m) => (
                            <div key={m.key}
                                style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                                <div style={{
                                    padding: "8px 11px", background: "var(--paper)",
                                    borderBottom: "1px solid var(--border)",
                                }}>
                                    <div className="row" style={{ gap: 7 }}>
                                        <strong className="small">{m.label}</strong>
                                        {m.ownerOnly && <span className="badge badge-amber">Owner only</span>}
                                    </div>
                                    {m.hint && <div className="xsmall faint">{m.hint}</div>}
                                </div>
                                <div className="row wrap" style={{ gap: 6, padding: "9px 11px" }}>
                                    {m.actions.map((a) => (
                                        <label key={a.permission}
                                            title={a.grantable ? a.permission : "Only the owner can grant this."}
                                            className="check-row"
                                            style={{
                                                border: "1px solid var(--border)", borderRadius: 8,
                                                padding: "5px 10px", fontSize: 12.5,
                                                opacity: a.grantable ? 1 : 0.5,
                                                cursor: a.grantable ? "pointer" : "not-allowed",
                                                background: has(a.permission) ? "var(--basil-soft)" : "var(--card)",
                                                borderColor: has(a.permission) ? "var(--basil)" : "var(--border)",
                                            }}>
                                            <input type="checkbox" checked={has(a.permission)}
                                                disabled={!a.grantable}
                                                onChange={() => toggle(a.permission, a.grantable)} />
                                            {a.action[0].toUpperCase() + a.action.slice(1)}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
