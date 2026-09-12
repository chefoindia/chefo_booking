"use client";
// app/dashboard/qr/page.js — the QR poster editor.
//
// A canvas paints the poster (lib/poster.js); a transparent overlay on top of
// it carries one hit-box per element, so you click to select, drag to move,
// pull the corner handle to resize, and edit the selected element's text,
// font, colour and alignment in the panel. Arrow keys nudge, Delete hides,
// Ctrl+Z / Ctrl+Y undo and redo. Themes recolour everything at once. The
// design is saved to the business (so it survives a new browser) and the
// download is the same painter at full 1080 × 1920.
//
// Deliberately NOT Canva: no free-form uploads or arbitrary layers. A poster
// that always contains a scannable code, the shop name and a call to action
// is the point; the freedom is in how those look and where they sit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { put } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import { Field, Input, Select, Check } from "@/components/Field";
import Drawer from "@/components/Drawer";
import { saveBlob } from "@/lib/download";
import { POSTER_W, POSTER_H, THEMES, FONTS, defaultPoster, normalizePoster, applyTheme, drawPoster, renderPng, renderQrOnly } from "@/lib/poster";

const LABEL = {
    brand: "Small header", title: "Big word 1", title2: "Big word 2", qr: "QR code", caption: "Call to action",
    shop: "Shop name", address: "Address", contact: "Contact", cloudL: "Cloud (left)", cloudR: "Cloud (right)", leafL: "Leaves (left)", leafR: "Leaves (right)",
};
const COLOR_CHOICES = [["ink", "Text colour"], ["accent", "Accent"], ["#FFFFFF", "White"], ["#000000", "Black"]];

export default function QrPage() {
    const access = useAccess();
    const toast = useToast();
    const business = access.business || {};
    const canEdit = access.can("config.edit");
    const url = `${process.env.NEXT_PUBLIC_CUSTOMER_URL || "http://localhost:4003"}/b/${business.slug}`;

    const [poster, setPosterRaw] = useState(() => (business.qrPoster ? normalizePoster(business.qrPoster, business) : defaultPoster(business)));
    const [selected, setSelected] = useState("qr");
    const [boxes, setBoxes] = useState({});
    const [scale, setScale] = useState(0.34);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState(null);
    const history = useRef({ past: [], future: [] });
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const logoRef = useRef(null);
    const dragRef = useRef(null);

    // Undo-able state changes go through here.
    const setPoster = useCallback((updater, { record = true } = {}) => {
        setPosterRaw((prev) => {
            const next = typeof updater === "function" ? updater(prev) : updater;
            if (record) { history.current.past.push(prev); history.current.future = []; if (history.current.past.length > 60) history.current.past.shift(); }
            return next;
        });
        setDirty(true);
    }, []);
    const undo = useCallback(() => {
        const p = history.current.past.pop();
        if (!p) return;
        setPosterRaw((cur) => { history.current.future.push(cur); return p; });
        setDirty(true);
    }, []);
    const redo = useCallback(() => {
        const f = history.current.future.pop();
        if (!f) return;
        setPosterRaw((cur) => { history.current.past.push(cur); return f; });
        setDirty(true);
    }, []);

    // The Chefo mark, for the QR centre.
    useEffect(() => {
        const img = new Image();
        img.onload = () => { logoRef.current = img; repaint(); };
        img.src = "/chefo-mark.png";
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fit the preview to the available height.
    useEffect(() => {
        const fit = () => {
            const h = Math.max(420, Math.min(window.innerHeight - 200, 760));
            setScale(Math.min(h / POSTER_H, (Math.min(window.innerWidth - 60, 520)) / POSTER_W));
        };
        fit();
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, []);

    const repaint = useCallback(async () => {
        if (!canvasRef.current) return;
        const b = await drawPoster(canvasRef.current, poster, { scale, url, logoImg: logoRef.current });
        setBoxes(b);
    }, [poster, scale, url]);
    useEffect(() => { repaint(); }, [repaint]);

    /* ------------------------------------------------ element edits */
    const el = poster.elements[selected];
    const patch = (id, changes, opts) => setPoster((p) => ({ ...p, elements: { ...p.elements, [id]: { ...p.elements[id], ...changes } } }), opts);
    const move = (id, dx, dy) => patch(id, { x: Math.round(poster.elements[id].x + dx), y: Math.round(poster.elements[id].y + dy) }, { record: false });
    const reorder = (id, dir) => setPoster((p) => {
        const order = [...p.order];
        const i = order.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= order.length) return p;
        [order[i], order[j]] = [order[j], order[i]];
        return { ...p, order };
    });

    /* ------------------------------------------------ pointer: drag + resize */
    const onPointerDown = (e, id, mode = "move") => {
        if (!canEdit) return;
        e.preventDefault();
        e.stopPropagation();
        setSelected(id);
        const start = poster.elements[id];
        dragRef.current = { id, mode, sx: e.clientX, sy: e.clientY, ox: start.x, oy: start.y, osize: start.size, snapshot: poster };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale;
        if (d.mode === "move") {
            patch(d.id, { x: Math.round(Math.max(0, Math.min(POSTER_W, d.ox + dx))), y: Math.round(Math.max(0, Math.min(POSTER_H, d.oy + dy))) }, { record: false });
        } else {
            const grow = Math.max(dx, dy);
            patch(d.id, { size: Math.round(Math.max(12, Math.min(1000, d.osize + grow))) }, { record: false });
        }
    };
    const onPointerUp = () => {
        const d = dragRef.current;
        if (!d) return;
        dragRef.current = null;
        // One undo step for the whole drag.
        history.current.past.push(d.snapshot);
        history.current.future = [];
    };

    // Keyboard: nudge, hide, undo/redo — only when not typing in a field.
    useEffect(() => {
        const onKey = (e) => {
            const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
            if (typing || !selected || !canEdit) return;
            const step = e.shiftKey ? 20 : 4;
            if (e.key === "ArrowLeft") { e.preventDefault(); move(selected, -step, 0); }
            else if (e.key === "ArrowRight") { e.preventDefault(); move(selected, step, 0); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(selected, 0, -step); }
            else if (e.key === "ArrowDown") { e.preventDefault(); move(selected, 0, step); }
            else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (selected !== "qr") patch(selected, { visible: false }); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, poster, canEdit, undo, redo]);

    /* ------------------------------------------------ actions */
    const download = async () => {
        setBusy(true);
        try {
            const blob = await renderPng(poster, { url, logoImg: logoRef.current });
            saveBlob(blob, `${business.slug || "chefo"}-qr-poster.png`);
            toast("success", "Poster downloaded", "1080 × 1920 PNG — prints well at A4 or A5.");
        } catch (e) { toast("error", "Couldn't render the poster", e.message); }
        finally { setBusy(false); }
    };
    const downloadQr = async () => {
        try { saveBlob(await renderQrOnly(url), `${business.slug || "chefo"}-qr.png`); toast("success", "QR downloaded", "Plain code on white, 1024 px."); }
        catch (e) { toast("error", "Couldn't render the code", e.message); }
    };
    const copyLink = async () => {
        try { await navigator.clipboard.writeText(url); toast("success", "Link copied", url); } catch { toast("error", "Couldn't copy", "Select the link and copy it manually."); }
    };
    const askSave = () => setConfirm({
        title: "Save this design?",
        body: "It becomes the saved poster for your business and is what you'll see the next time you open this page, on any device.",
        label: "Save design",
        action: async () => {
            setBusy(true);
            try {
                await put("/api/config/qr-poster", { poster });
                toast("success", "Design saved", "Your poster is stored with the business.");
                setDirty(false); setConfirm(null);
                await access.reload?.();
            } catch (e) { toast("error", "Couldn't save", e.message); }
            finally { setBusy(false); }
        },
    });
    const askReset = () => setConfirm({
        title: "Start again from the template?",
        body: "Your positions, text and colours on this page are replaced with the default layout. The saved design is untouched until you save.",
        label: "Reset layout", danger: true,
        action: () => { setPoster(defaultPoster(business, poster.theme)); setSelected("qr"); setConfirm(null); },
    });

    const box = (id) => boxes[id];
    const hidden = useMemo(() => poster.order.filter((id) => poster.elements[id]?.visible === false), [poster]);

    return (
        <div>
            <div className="page-head">
                <div>
                    <h1 className="page-title">QR poster</h1>
                    <p className="page-sub">A print-ready poster with your booking link. Click an element to edit it, drag to move, pull the corner to resize.</p>
                </div>
                <div className="row wrap">
                    <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.current.past.length} title="Ctrl+Z">Undo</button>
                    <button className="btn btn-ghost btn-sm" onClick={redo} disabled={!history.current.future.length} title="Ctrl+Y">Redo</button>
                    <button className="btn btn-secondary" onClick={downloadQr}>QR only (PNG)</button>
                    <button className="btn btn-primary" onClick={download} disabled={busy}>{busy ? "Rendering…" : "Download poster (PNG)"}</button>
                    {canEdit && <button className="btn btn-secondary" onClick={askSave} disabled={!dirty || busy}>Save design…</button>}
                </div>
            </div>

            <div className="qr-layout">
                {/* ---- canvas + overlay ---- */}
                <div className="card qr-stage" ref={wrapRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
                    <div className="qr-frame" style={{ width: POSTER_W * scale, height: POSTER_H * scale }} onPointerDown={() => setSelected(null)}>
                        <canvas ref={canvasRef} style={{ width: POSTER_W * scale, height: POSTER_H * scale, display: "block", borderRadius: 10 }} />
                        {poster.order.map((id) => {
                            const b = box(id);
                            if (!b || poster.elements[id]?.visible === false) return null;
                            const sel = id === selected;
                            return (
                                <div key={id} className={`qr-hit ${sel ? "sel" : ""}`} title={LABEL[id] || id}
                                    style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, cursor: canEdit ? "move" : "default" }}
                                    onPointerDown={(e) => onPointerDown(e, id, "move")}>
                                    {sel && canEdit && <span className="qr-handle" onPointerDown={(e) => onPointerDown(e, id, "resize")} title="Drag to resize" />}
                                    {sel && <span className="qr-tag">{LABEL[id] || id}</span>}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ---- properties ---- */}
                <div className="qr-panel">
                    <div className="card card-pad">
                        <div className="num-label" style={{ marginBottom: 8 }}>Theme</div>
                        <div className="row wrap" style={{ gap: 8 }}>
                            {Object.entries(THEMES).map(([k, t]) => (
                                <button key={k} className={`qr-swatch ${poster.theme === k ? "on" : ""}`} disabled={!canEdit} title={t.label}
                                    style={{ background: t.bg, borderColor: poster.theme === k ? t.accent : "var(--border-strong)" }}
                                    onClick={() => setPoster((p) => applyTheme(p, k))}>
                                    <i style={{ background: t.accent }} /><b style={{ color: t.ink }}>Aa</b>
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-3" style={{ marginTop: 12, gap: 8 }}>
                            <ColorField label="Background" value={poster.colors.bg} disabled={!canEdit} onChange={(v) => setPoster((p) => ({ ...p, colors: { ...p.colors, bg: v } }))} />
                            <ColorField label="Text" value={poster.colors.ink} disabled={!canEdit} onChange={(v) => setPoster((p) => ({ ...p, colors: { ...p.colors, ink: v } }))} />
                            <ColorField label="Accent" value={poster.colors.accent} disabled={!canEdit} onChange={(v) => setPoster((p) => ({ ...p, colors: { ...p.colors, accent: v } }))} />
                        </div>
                    </div>

                    <div className="card card-pad">
                        <div className="row-between" style={{ marginBottom: 8 }}>
                            <div className="num-label">{el ? LABEL[selected] || selected : "Nothing selected"}</div>
                            {el && canEdit && (
                                <div className="row" style={{ gap: 4 }}>
                                    <button className="btn btn-ghost btn-sm" onClick={() => reorder(selected, 1)} title="Bring forward">▲</button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => reorder(selected, -1)} title="Send back">▼</button>
                                    {selected !== "qr" && <button className="btn btn-ghost btn-sm" onClick={() => patch(selected, { visible: false })} title="Hide (Delete)">Hide</button>}
                                </div>
                            )}
                        </div>
                        {!el ? (
                            <p className="small muted">Click anything on the poster to edit it.</p>
                        ) : el.type === "text" ? (
                            <div className="stack-sm">
                                <Field label="Text"><textarea className="textarea" rows={2} style={{ minHeight: 56 }} value={el.text} disabled={!canEdit} onChange={(e) => patch(selected, { text: e.target.value })} /></Field>
                                <div className="grid grid-2" style={{ gap: 8 }}>
                                    <Field label="Font"><Select value={el.font || "Sora"} disabled={!canEdit} onChange={(e) => patch(selected, { font: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</Select></Field>
                                    <Field label="Weight"><Select value={el.weight || 400} disabled={!canEdit} onChange={(e) => patch(selected, { weight: Number(e.target.value) })}><option value={400}>Regular</option><option value={600}>Semi-bold</option><option value={700}>Bold</option><option value={800}>Extra-bold</option></Select></Field>
                                    <Field label={`Size — ${el.size}px`}><input type="range" min="14" max="320" value={el.size} disabled={!canEdit} onChange={(e) => patch(selected, { size: Number(e.target.value) }, { record: false })} onMouseUp={() => setDirty(true)} style={{ width: "100%" }} /></Field>
                                    <Field label="Align"><Select value={el.align || "center"} disabled={!canEdit} onChange={(e) => patch(selected, { align: e.target.value })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></Select></Field>
                                    <Field label="Colour"><Select value={COLOR_CHOICES.some(([v]) => v === el.color) ? el.color : "custom"} disabled={!canEdit} onChange={(e) => e.target.value !== "custom" && patch(selected, { color: e.target.value })}>{COLOR_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}<option value="custom">Custom…</option></Select></Field>
                                    <Field label="Custom colour"><input type="color" className="input" style={{ padding: 2, height: 38 }} disabled={!canEdit} value={/^#/.test(el.color) ? el.color : "#000000"} onChange={(e) => patch(selected, { color: e.target.value }, { record: false })} /></Field>
                                    <Field label={`Letter spacing — ${el.spacing || 0}`}><input type="range" min="-12" max="24" value={el.spacing || 0} disabled={!canEdit} onChange={(e) => patch(selected, { spacing: Number(e.target.value) }, { record: false })} style={{ width: "100%" }} /></Field>
                                    <Field label={`Wrap width — ${el.w || "none"}`}><input type="range" min="200" max="1000" value={el.w || 1000} disabled={!canEdit} onChange={(e) => patch(selected, { w: Number(e.target.value) >= 1000 ? undefined : Number(e.target.value) }, { record: false })} style={{ width: "100%" }} /></Field>
                                </div>
                            </div>
                        ) : el.type === "qr" ? (
                            <div className="stack-sm">
                                <div className="banner banner-info small">Encodes <span className="mono" style={{ wordBreak: "break-all" }}>{url}</span></div>
                                <div className="grid grid-2" style={{ gap: 8 }}>
                                    <Field label={`Size — ${el.size}px`}><input type="range" min="300" max="900" value={el.size} disabled={!canEdit} onChange={(e) => patch(selected, { size: Number(e.target.value) }, { record: false })} style={{ width: "100%" }} /></Field>
                                    <Field label="Centre logo"><Select value={el.logo || ""} disabled={!canEdit} onChange={(e) => patch(selected, { logo: e.target.value })}><option value="">None</option><option value="chefo">Chefo mark</option><option value="🌼">🌼 Daisy</option><option value="🍛">🍛 Curry</option><option value="🍽️">🍽️ Plate</option><option value="🥗">🥗 Salad</option><option value="☕">☕ Cup</option></Select></Field>
                                    <Field label="Code colour"><Select value={el.fg} disabled={!canEdit} onChange={(e) => patch(selected, { fg: e.target.value })}><option value="ink">Text colour</option><option value="accent">Accent</option><option value="#000000">Black</option></Select></Field>
                                    <Field label={`Corner radius — ${el.corner}`}><input type="range" min="0" max="80" value={el.corner} disabled={!canEdit} onChange={(e) => patch(selected, { corner: Number(e.target.value) }, { record: false })} style={{ width: "100%" }} /></Field>
                                </div>
                                <p className="xsmall faint">The code always sits on a white card and keeps a quiet margin, so it scans on any theme. Test it with your phone before printing a batch.</p>
                            </div>
                        ) : (
                            <div className="stack-sm">
                                <div className="grid grid-2" style={{ gap: 8 }}>
                                    <Field label={`Size — ${el.size}px`}><input type="range" min="40" max="500" value={el.size} disabled={!canEdit} onChange={(e) => patch(selected, { size: Number(e.target.value) }, { record: false })} style={{ width: "100%" }} /></Field>
                                    <Field label="Colour"><Select value={COLOR_CHOICES.some(([v]) => v === el.color) ? el.color : "custom"} disabled={!canEdit} onChange={(e) => e.target.value !== "custom" && patch(selected, { color: e.target.value })}>{COLOR_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}<option value="custom">Custom…</option></Select></Field>
                                    <Field label="Custom colour"><input type="color" className="input" style={{ padding: 2, height: 38 }} disabled={!canEdit} value={/^#/.test(el.color) ? el.color : "#ffffff"} onChange={(e) => patch(selected, { color: e.target.value }, { record: false })} /></Field>
                                    {el.shape === "leaf" && <Field label="Direction"><Check label="Flip" checked={Boolean(el.flip)} disabled={!canEdit} onChange={(e) => patch(selected, { flip: e.target.checked })} /></Field>}
                                </div>
                            </div>
                        )}
                        {el && <p className="xsmall faint" style={{ marginTop: 8 }}>Position {el.x}, {el.y} · arrow keys nudge (Shift = faster)</p>}
                    </div>

                    <div className="card card-pad">
                        <div className="num-label" style={{ marginBottom: 8 }}>Elements</div>
                        <div className="qr-elist">
                            {[...poster.order].reverse().map((id) => {
                                const e = poster.elements[id];
                                return (
                                    <button key={id} className={`qr-eitem ${id === selected ? "on" : ""} ${e.visible === false ? "off" : ""}`} onClick={() => setSelected(id)}>
                                        <span>{LABEL[id] || id}</span>
                                        {e.visible === false
                                            ? <span className="link-btn" onClick={(ev) => { ev.stopPropagation(); patch(id, { visible: true }); }}>Show</span>
                                            : <span className="xsmall faint">{e.type}</span>}
                                    </button>
                                );
                            })}
                        </div>
                        {hidden.length > 0 && <p className="xsmall faint" style={{ marginTop: 6 }}>{hidden.length} hidden — click Show to bring one back.</p>}
                    </div>

                    <div className="card card-pad">
                        <div className="num-label" style={{ marginBottom: 6 }}>Your booking link</div>
                        <div className="row" style={{ gap: 6 }}>
                            <Input readOnly value={url} className="input mono" style={{ fontSize: 12 }} onFocus={(e) => e.target.select()} />
                            <button className="btn btn-secondary btn-sm" onClick={copyLink}>Copy</button>
                        </div>
                        {canEdit && <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={askReset}>Reset to template…</button>}
                    </div>
                </div>
            </div>

            <Drawer open={Boolean(confirm)} onClose={() => !busy && setConfirm(null)} title={confirm?.title || ""}
                footer={<>
                    <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>Go back</button>
                    <button className={`btn ${confirm?.danger ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={confirm?.action}>{busy ? "Working…" : confirm?.label}</button>
                </>}>
                <p style={{ marginTop: 0, lineHeight: 1.6 }}>{confirm?.body}</p>
            </Drawer>

            <style>{`
              .qr-layout { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
              @media (min-width: 980px) { .qr-layout { grid-template-columns: auto 1fr; } }
              .qr-stage { padding: 16px; display: flex; justify-content: center; background: var(--paper); user-select: none; touch-action: none; }
              .qr-frame { position: relative; box-shadow: var(--shadow-lg); border-radius: 10px; }
              .qr-hit { position: absolute; border: 1px dashed transparent; border-radius: 4px; }
              .qr-hit:hover { border-color: rgba(32,110,78,.45); }
              .qr-hit.sel { border: 2px solid var(--basil); box-shadow: 0 0 0 3px rgba(32,110,78,.18); }
              .qr-handle { position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px; border-radius: 3px; background: var(--basil); border: 2px solid #fff; cursor: nwse-resize; }
              .qr-tag { position: absolute; left: -2px; top: -22px; font-size: 10.5px; font-weight: 700; background: var(--basil); color: #fff; padding: 2px 7px; border-radius: 5px; white-space: nowrap; }
              .qr-panel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
              .qr-swatch { position: relative; width: 52px; height: 40px; border: 2px solid; border-radius: 9px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; }
              .qr-swatch i { width: 10px; height: 10px; border-radius: 50%; }
              .qr-swatch b { font-family: var(--font-display); font-size: 13px; }
              .qr-swatch.on { box-shadow: 0 0 0 3px var(--basil-soft); }
              .qr-elist { display: flex; flex-direction: column; gap: 3px; }
              .qr-eitem { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 7px 10px; border-radius: 8px; border: 1px solid transparent; background: none; cursor: pointer; font: inherit; font-size: 13px; color: var(--ink); }
              .qr-eitem:hover { background: var(--paper); }
              .qr-eitem.on { background: var(--basil-soft); border-color: #cfe4d8; color: var(--basil-dark); font-weight: 600; }
              .qr-eitem.off span:first-child { color: var(--faint); text-decoration: line-through; }
            `}</style>
        </div>
    );
}

function ColorField({ label, value, onChange, disabled }) {
    return (
        <Field label={label}>
            <div className="row" style={{ gap: 6 }}>
                <input type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ width: 36, height: 34, padding: 2, border: "1px solid var(--border-strong)", borderRadius: 8, background: "var(--card)" }} />
                <span className="mono xsmall muted">{value}</span>
            </div>
        </Field>
    );
}
