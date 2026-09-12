"use client";
// app/dashboard/menu/page.js — the weekly menu planner.
//
// A grid per meal service: one row per meal option (Veg, Non-Veg, …), one
// column per weekday, one dish per line in each cell. This is what customers
// see under each option on the booking page for that weekday.
//
// EDITING IS A DRAFT. Cells edit freely; changed days are marked; one
// "Save changes…" opens the confirmation drawer listing exactly which days
// will be written. Nothing reaches the server until then, which is also what
// makes "Discard" and day-level copy/paste safe to offer.
//
// SHORTCUTS (with a cell focused):  Alt+C copy that day · Alt+V paste into
// that day · Alt+X clear that day · Alt+D copy that day to every other day.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { get, put } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import { Input, Check } from "@/components/Field";
import Drawer from "@/components/Drawer";
import Empty from "@/components/Empty";
import { SkeletonTable } from "@/components/Skeleton";
import { openDoc, table, heading, closeDoc } from "@/lib/pdf";

const DAY_LABEL = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
const DAY_FULL = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
const todayWeekday = () => ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
    new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getDay()];

/** draft[mealTypeId][weekday] = { served, note, items: { [variantId]: "line\nline" } } */
const emptyDay = () => ({ served: true, note: "", items: {} });

function toDraft(menus) {
    const d = {};
    for (const m of menus) {
        d[m.mealTypeId] = d[m.mealTypeId] || {};
        d[m.mealTypeId][m.weekday] = {
            served: m.served !== false,
            note: m.note || "",
            items: Object.fromEntries((m.entries || []).map((e) => [String(e.variantId), (e.items || []).join("\n")])),
        };
    }
    return d;
}
const dayOf = (draft, mealId, wd) => draft?.[mealId]?.[wd] || emptyDay();
const sameDay = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function MenuPage() {
    const access = useAccess();
    const toast = useToast();
    const canEdit = access.can("menu.edit");

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mealId, setMealId] = useState("");
    const [draft, setDraft] = useState({});
    const [saved, setSaved] = useState({});
    const [clip, setClip] = useState(null);           // a copied day: { mealId, wd, day }
    const [confirm, setConfirm] = useState(null);
    const [busy, setBusy] = useState(false);
    const [copyOpen, setCopyOpen] = useState(false);
    const focusRef = useRef({ mealId: "", wd: "" });

    const load = useCallback(async () => {
        try {
            const res = await get("/api/menu");
            setData(res);
            const d = toDraft(res.menus || []);
            setDraft(d);
            setSaved(JSON.parse(JSON.stringify(d)));
            setMealId((cur) => cur || res.mealTypes.find((m) => m.active)?._id || res.mealTypes[0]?._id || "");
        } catch (e) { toast("error", "Couldn't load the menu", e.message); }
        finally { setLoading(false); }
    }, [toast]);
    useEffect(() => { load(); }, [load]);

    const weekdays = data?.weekdays || [];
    const meal = data?.mealTypes.find((m) => String(m._id) === String(mealId));
    const options = useMemo(() => (data?.variants || []).filter((v) => v.active
        && (!v.mealTypeIds?.length || v.mealTypeIds.some((id) => String(id) === String(mealId)))), [data, mealId]);

    /* ------------------------------------------------ draft edits */
    const setDay = (mId, wd, patch) => setDraft((d) => ({
        ...d, [mId]: { ...(d[mId] || {}), [wd]: { ...dayOf(d, mId, wd), ...patch } },
    }));
    const setCell = (mId, wd, variantId, text) => setDraft((d) => {
        const day = dayOf(d, mId, wd);
        return { ...d, [mId]: { ...(d[mId] || {}), [wd]: { ...day, items: { ...day.items, [variantId]: text } } } };
    });

    const dirtyDays = useMemo(() => {
        const out = [];
        for (const m of data?.mealTypes || []) for (const wd of weekdays) {
            if (!sameDay(dayOf(draft, m._id, wd), dayOf(saved, m._id, wd))) out.push({ mealId: String(m._id), mealName: m.name, wd });
        }
        return out;
    }, [draft, saved, data, weekdays]);

    /* ------------------------------------------------ day operations */
    const copyDay = (mId, wd) => {
        setClip({ mealId: mId, wd, day: JSON.parse(JSON.stringify(dayOf(draft, mId, wd))) });
        toast("success", "Day copied", `${DAY_FULL[wd]} ${data.mealTypes.find((m) => String(m._id) === String(mId))?.name} — press Alt+V on another day to paste.`);
    };
    const pasteDay = (mId, wd) => {
        if (!clip) return toast("error", "Nothing copied yet", "Copy a day first (Alt+C).");
        setDay(mId, wd, JSON.parse(JSON.stringify(clip.day)));
    };
    const clearDay = (mId, wd) => setDay(mId, wd, emptyDay());
    const fillWeek = (mId, wd) => {
        const src = JSON.parse(JSON.stringify(dayOf(draft, mId, wd)));
        setDraft((d) => ({ ...d, [mId]: Object.fromEntries(weekdays.map((w) => [w, w === wd ? dayOf(d, mId, w) : JSON.parse(JSON.stringify(src))])) }));
        toast("success", "Applied to the week", `${DAY_FULL[wd]}'s menu now fills every day. Save when you're happy.`);
    };

    // Keyboard shortcuts act on the day of the focused cell.
    useEffect(() => {
        const onKey = (e) => {
            if (!e.altKey || e.ctrlKey || e.metaKey) return;
            const { mealId: mId, wd } = focusRef.current;
            if (!mId || !wd || !canEdit) return;
            const k = e.key.toLowerCase();
            if (k === "c") { e.preventDefault(); copyDay(mId, wd); }
            else if (k === "v") { e.preventDefault(); pasteDay(mId, wd); }
            else if (k === "x") { e.preventDefault(); clearDay(mId, wd); }
            else if (k === "d") { e.preventDefault(); fillWeek(mId, wd); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clip, draft, canEdit, weekdays]);

    /* ------------------------------------------------ save */
    const askSave = () => setConfirm({
        title: `Save ${dirtyDays.length} day${dirtyDays.length === 1 ? "" : "s"}?`,
        body: `The booking page changes immediately for: ${dirtyDays.map((d) => `${d.mealName} ${DAY_LABEL[d.wd]}`).join(", ")}. Customers booking those days will see the new menu.`,
        label: "Save menu",
        action: async () => {
            setBusy(true);
            try {
                for (const d of dirtyDays) {
                    const day = dayOf(draft, d.mealId, d.wd);
                    await put(`/api/menu/${d.mealId}/${d.wd}`, {
                        served: day.served, note: day.note,
                        entries: Object.entries(day.items).map(([variantId, text]) => ({
                            variantId, items: String(text).split("\n").map((s) => s.trim()).filter(Boolean),
                        })).filter((e) => e.items.length),
                    });
                }
                toast("success", "Menu saved", `${dirtyDays.length} day${dirtyDays.length === 1 ? "" : "s"} updated.`);
                setConfirm(null);
                await load();
            } catch (e) { toast("error", "Couldn't save", e.message); }
            finally { setBusy(false); }
        },
    });

    const discard = () => setDraft(JSON.parse(JSON.stringify(saved)));

    /* ------------------------------------------------ PDF */
    const downloadPdf = async () => {
        const business = access.business;
        const doc = openDoc({ business, title: "Weekly menu", subtitle: "What is served, per meal service and option", orientation: "landscape" });
        for (const m of data.mealTypes.filter((x) => x.active)) {
            const opts = data.variants.filter((v) => v.active && (!v.mealTypeIds?.length || v.mealTypeIds.some((id) => String(id) === String(m._id))));
            const times = m.startTime && m.endTime ? `Served ${fmt12(m.startTime)} – ${fmt12(m.endTime)}` : "";
            const cut = m.cutoffTime ? `Book by ${fmt12(m.cutoffTime)}${m.cutoffPreviousDay ? " the day before" : ""}` : "No booking cutoff";
            heading(doc, m.name, [times, cut].filter(Boolean).join("  ·  "));
            const body = opts.map((v) => [
                v.name + (v.price ? `\nRs ${v.price}` : ""),
                ...weekdays.map((wd) => {
                    const day = dayOf(saved, m._id, wd);
                    if (day.served === false) return "— not served —";
                    const lines = String(day.items[String(v._id)] || "").split("\n").map((s) => s.trim()).filter(Boolean);
                    return lines.length ? lines.map((l) => `• ${l}`).join("\n") : "";
                }),
            ]);
            const noteRow = weekdays.some((wd) => dayOf(saved, m._id, wd).note)
                ? [["Note", ...weekdays.map((wd) => dayOf(saved, m._id, wd).note || "")]] : [];
            table(doc, {
                head: ["Option", ...weekdays.map((wd) => DAY_FULL[wd])],
                body: [...body, ...noteRow],
                compact: true,
                columnStyles: { 0: { cellWidth: 82, fontStyle: "bold" } },
            });
        }
        await closeDoc(doc, `weekly-menu-${business?.slug || "chefo"}.pdf`, { what: "the weekly menu", details: { mealServices: data.mealTypes.filter((x) => x.active).length } });
    };

    if (loading || !data) {
        return <div><div className="page-head"><div><h1 className="page-title">Weekly menu</h1></div></div><SkeletonTable rows={4} cols={8} /></div>;
    }

    const customerUrl = `${process.env.NEXT_PUBLIC_CUSTOMER_URL || "http://localhost:4003"}/b/${access.business?.slug}`;
    const today = todayWeekday();

    return (
        <div>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Weekly menu</h1>
                    <p className="page-sub">What each meal service serves on each day, split by option. Customers see this on the booking page.</p>
                </div>
                <div className="row wrap">
                    <button className="btn btn-secondary" onClick={downloadPdf} disabled={!data.mealTypes.length}>Download menu (PDF)</button>
                    {canEdit && <button className="btn btn-secondary" onClick={() => setCopyOpen(true)} disabled={!meal}>Copy between services…</button>}
                    {canEdit && dirtyDays.length > 0 && <button className="btn btn-ghost" onClick={discard}>Discard</button>}
                    {canEdit && (
                        <button className="btn btn-primary" onClick={askSave} disabled={!dirtyDays.length}>
                            Save changes{dirtyDays.length ? ` (${dirtyDays.length})…` : "…"}
                        </button>
                    )}
                </div>
            </div>

            {!data.mealTypes.length ? (
                <div className="card"><Empty title="No meal services yet" note="Add your meal services in Settings first — the menu is planned per service." icon="menu"
                    action={<Link href="/dashboard/settings" className="btn btn-primary btn-sm">Open settings</Link>} /></div>
            ) : !options.length && meal ? (
                <>
                    <MealTabs data={data} mealId={mealId} setMealId={setMealId} dirtyDays={dirtyDays} />
                    <div className="card"><Empty title={`No options for ${meal.name}`} note="Add at least one meal option (Veg, Non-Veg…) in Settings, or allow an existing one for this service." icon="menu"
                        action={<Link href="/dashboard/settings" className="btn btn-primary btn-sm">Open settings</Link>} /></div>
                </>
            ) : (
                <>
                    <MealTabs data={data} mealId={mealId} setMealId={setMealId} dirtyDays={dirtyDays} />

                    <div className="card">
                        <div className="table-wrap">
                            <table className="tbl menu-grid">
                                <thead>
                                    <tr>
                                        <th style={{ minWidth: 150 }}>Option</th>
                                        {weekdays.map((wd) => {
                                            const day = dayOf(draft, mealId, wd);
                                            const dirty = dirtyDays.some((d) => d.mealId === String(mealId) && d.wd === wd);
                                            return (
                                                <th key={wd} className={`menu-day ${wd === today ? "today" : ""} ${day.served ? "" : "off"}`}>
                                                    <div className="row-between">
                                                        <span>{DAY_FULL[wd]}{dirty && <i className="menu-dot" title="Unsaved" />}</span>
                                                        {canEdit && (
                                                            <span className="row" style={{ gap: 2 }}>
                                                                <button className="menu-ico" title="Copy this day (Alt+C)" onClick={() => copyDay(mealId, wd)}>⧉</button>
                                                                <button className="menu-ico" title="Paste into this day (Alt+V)" disabled={!clip} onClick={() => pasteDay(mealId, wd)}>⇩</button>
                                                                <button className="menu-ico" title="Apply this day to the whole week (Alt+D)" onClick={() => fillWeek(mealId, wd)}>⇶</button>
                                                                <button className="menu-ico" title="Clear this day (Alt+X)" onClick={() => clearDay(mealId, wd)}>✕</button>
                                                            </span>
                                                        )}
                                                    </div>
                                                    <label className="check-row xsmall" style={{ marginTop: 4, textTransform: "none", letterSpacing: 0, color: "var(--slate)", fontWeight: 500 }}>
                                                        <input type="checkbox" checked={day.served} disabled={!canEdit} onChange={(e) => setDay(mealId, wd, { served: e.target.checked })} />
                                                        Served
                                                    </label>
                                                </th>
                                            );
                                        })}
                                    </tr>
                                </thead>
                                <tbody>
                                    {options.map((v) => (
                                        <tr key={v._id}>
                                            <td>
                                                <strong>{v.name}</strong>
                                                <div className="xsmall faint">{v.price ? `₹${v.price} per meal` : "No price set"}</div>
                                            </td>
                                            {weekdays.map((wd) => {
                                                const day = dayOf(draft, mealId, wd);
                                                return (
                                                    <td key={wd} className={`menu-cell ${day.served ? "" : "off"}`}>
                                                        <textarea
                                                            className="menu-ta"
                                                            rows={4}
                                                            placeholder={day.served ? "One dish per line" : "Not served"}
                                                            disabled={!canEdit || !day.served}
                                                            value={day.items[String(v._id)] || ""}
                                                            onFocus={() => { focusRef.current = { mealId: String(mealId), wd }; }}
                                                            onChange={(e) => setCell(mealId, wd, String(v._id), e.target.value)}
                                                        />
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                    <tr>
                                        <td><span className="small muted">Note for the day</span><div className="xsmall faint">Shown under the menu.</div></td>
                                        {weekdays.map((wd) => (
                                            <td key={wd} className="menu-cell">
                                                <Input value={dayOf(draft, mealId, wd).note} disabled={!canEdit} maxLength={200} placeholder="Optional"
                                                    onFocus={() => { focusRef.current = { mealId: String(mealId), wd }; }}
                                                    onChange={(e) => setDay(mealId, wd, { note: e.target.value })} style={{ fontSize: 12.5 }} />
                                            </td>
                                        ))}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div className="pager" style={{ justifyContent: "space-between" }}>
                            <span className="xsmall faint">
                                Click a cell, then <kbd>Alt</kbd>+<kbd>C</kbd> copy day · <kbd>Alt</kbd>+<kbd>V</kbd> paste day · <kbd>Alt</kbd>+<kbd>D</kbd> apply to week · <kbd>Alt</kbd>+<kbd>X</kbd> clear day
                            </span>
                            <a className="xsmall" href={customerUrl} target="_blank" rel="noreferrer" style={{ color: "var(--basil-dark)", fontWeight: 600 }}>See it as a customer →</a>
                        </div>
                    </div>
                </>
            )}

            {/* Copy a whole week between meal services */}
            <CopyDrawer open={copyOpen} onClose={() => setCopyOpen(false)} data={data} fromMealId={mealId} weekdays={weekdays}
                onCopy={(targets) => {
                    setDraft((d) => {
                        const next = { ...d };
                        for (const t of targets) {
                            next[t] = Object.fromEntries(weekdays.map((wd) => [wd, JSON.parse(JSON.stringify(dayOf(d, mealId, wd)))]));
                        }
                        return next;
                    });
                    setCopyOpen(false);
                    toast("success", "Week copied", `Copied to ${targets.length} service${targets.length === 1 ? "" : "s"}. Review, then save.`);
                }} />

            <Drawer open={Boolean(confirm)} onClose={() => !busy && setConfirm(null)} title={confirm?.title || ""}
                footer={<>
                    <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>Go back</button>
                    <button className="btn btn-primary" disabled={busy} onClick={confirm?.action}>{busy ? "Saving…" : confirm?.label}</button>
                </>}>
                <p style={{ marginTop: 0, lineHeight: 1.6 }}>{confirm?.body}</p>
            </Drawer>

            <style>{`
              .menu-grid th.menu-day { min-width: 168px; text-transform: none; letter-spacing: 0; font-size: 13px; color: var(--ink); vertical-align: top; }
              .menu-grid th.menu-day.today { background: var(--basil-soft); }
              .menu-grid th.menu-day.off { color: var(--faint); }
              .menu-cell { padding: 6px !important; vertical-align: top; }
              .menu-cell.off { background: var(--paper); }
              .menu-ta { width: 100%; border: 1px solid transparent; border-radius: 8px; padding: 8px 9px; font: inherit; font-size: 13px; line-height: 1.45; resize: vertical; min-height: 84px; background: transparent; color: var(--ink); }
              .menu-ta:hover:not(:disabled) { border-color: var(--border); background: var(--card); }
              .menu-ta:focus { outline: none; border-color: var(--basil); box-shadow: 0 0 0 3px var(--basil-soft); background: var(--card); }
              .menu-ta:disabled { color: var(--faint); cursor: not-allowed; }
              .menu-ico { border: none; background: transparent; color: var(--faint); cursor: pointer; font-size: 13px; width: 22px; height: 22px; border-radius: 6px; line-height: 1; }
              .menu-ico:hover:not(:disabled) { background: var(--card); color: var(--basil-dark); }
              .menu-ico:disabled { opacity: .35; cursor: not-allowed; }
              .menu-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--turmeric); margin-left: 6px; vertical-align: middle; }
              kbd { font-family: var(--font-mono), monospace; font-size: 10.5px; padding: 1px 5px; border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 4px; background: var(--card); }
            `}</style>
        </div>
    );
}

function MealTabs({ data, mealId, setMealId, dirtyDays }) {
    return (
        <div className="row wrap" style={{ marginBottom: 14 }}>
            {data.mealTypes.map((m) => {
                const n = dirtyDays.filter((d) => d.mealId === String(m._id)).length;
                return (
                    <button key={m._id} className={`btn btn-sm ${String(m._id) === String(mealId) ? "btn-primary" : "btn-secondary"}`}
                        onClick={() => setMealId(String(m._id))} style={{ opacity: m.active ? 1 : 0.6 }}>
                        {m.name}{!m.active && " (inactive)"}{n > 0 && <span className="badge badge-amber" style={{ marginLeft: 6 }}>{n}</span>}
                    </button>
                );
            })}
        </div>
    );
}

function CopyDrawer({ open, onClose, data, fromMealId, onCopy }) {
    const [targets, setTargets] = useState([]);
    useEffect(() => { if (open) setTargets([]); }, [open]);
    const from = data.mealTypes.find((m) => String(m._id) === String(fromMealId));
    const others = data.mealTypes.filter((m) => String(m._id) !== String(fromMealId));
    return (
        <Drawer open={open} onClose={onClose} title={`Copy the ${from?.name || ""} week to…`}
            footer={<>
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" disabled={!targets.length} onClick={() => onCopy(targets)}>Copy into draft</button>
            </>}>
            <p className="small muted" style={{ marginTop: 0 }}>
                Every day of <strong>{from?.name}</strong> is copied into the services you tick, replacing what they have. Options that a target service doesn&apos;t offer are dropped. Nothing is saved until you press Save changes.
            </p>
            <div className="stack-sm">
                {others.map((m) => (
                    <Check key={m._id} label={m.name} checked={targets.includes(String(m._id))}
                        onChange={(e) => setTargets((t) => e.target.checked ? [...t, String(m._id)] : t.filter((x) => x !== String(m._id)))} />
                ))}
                {!others.length && <p className="small muted">There is no other meal service to copy to.</p>}
            </div>
        </Drawer>
    );
}

function fmt12(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
