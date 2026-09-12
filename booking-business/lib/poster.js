// lib/poster.js — the QR poster: its document model, its themes, and the one
// function that paints it.
//
// ONE RENDERER FOR PREVIEW AND EXPORT. The editor shows a scaled canvas and
// the download is the same canvas at full size, so what the owner drags into
// place is exactly what prints — no HTML-to-image approximation, no font
// substitution surprises. `drawPoster` also returns every element's bounding
// box, which is what the editor's selection/drag overlay is built from.
//
// Units are poster pixels (1080 × 1920, a 9:16 portrait like the template).
import QRCode from "qrcode";

export const POSTER_W = 1080;
export const POSTER_H = 1920;

/* ------------------------------------------------------------------ */
/* Themes — the whole palette of a poster in one choice                 */
/* ------------------------------------------------------------------ */
export const THEMES = {
    daisy: { label: "Daisy", bg: "#FFFCF2", ink: "#3A2B1B", accent: "#2E6B3C", soft: "#EAF3E7", qrFg: "#3A2B1B", qrBg: "#FFFFFF", logo: "🌼" },
    basil: { label: "Basil", bg: "#F6F7F5", ink: "#1C2520", accent: "#206E4E", soft: "#E9F3EE", qrFg: "#1C2520", qrBg: "#FFFFFF", logo: "chefo" },
    ink: { label: "Night", bg: "#1C2520", ink: "#FFFFFF", accent: "#7FBF93", soft: "#2A3630", qrFg: "#1C2520", qrBg: "#FFFFFF", logo: "chefo" },
    sunset: { label: "Turmeric", bg: "#FFF5E8", ink: "#4A2C1A", accent: "#C8871E", soft: "#FBE8C9", qrFg: "#4A2C1A", qrBg: "#FFFFFF", logo: "🍛" },
    lake: { label: "Lake", bg: "#EEF2F5", ink: "#1F2D3A", accent: "#3E5C76", soft: "#DCE6EF", qrFg: "#1F2D3A", qrBg: "#FFFFFF", logo: "🍽️" },
};

export const FONTS = ["Sora", "Public Sans", "IBM Plex Mono", "Georgia", "Arial"];

/* ------------------------------------------------------------------ */
/* The default document — the template the owner starts from           */
/* ------------------------------------------------------------------ */
export function defaultPoster(business = {}, themeKey = "daisy") {
    const t = THEMES[themeKey] || THEMES.daisy;
    const address = [business.addressLine, business.city].filter(Boolean).join(", ");
    const contact = [business.contactPhone, business.contactEmail].filter(Boolean).join("  ·  ");
    return {
        v: 1,
        theme: themeKey,
        colors: { bg: t.bg, ink: t.ink, accent: t.accent, soft: t.soft },
        order: ["cloudL", "cloudR", "leafL", "leafR", "brand", "title", "title2", "qr", "caption", "shop", "address", "contact"],
        elements: {
            brand: { type: "text", text: "CHEFO BOOKING", x: 540, y: 110, size: 26, weight: 600, font: "Sora", align: "center", color: "ink", spacing: 8, visible: true },
            title: { type: "text", text: "scan", x: 540, y: 320, size: 200, weight: 800, font: "Sora", align: "center", color: "ink", spacing: -6, visible: true },
            title2: { type: "text", text: "here", x: 540, y: 470, size: 200, weight: 800, font: "Sora", align: "center", color: "accent", spacing: -6, visible: true },
            qr: { type: "qr", x: 540, y: 960, size: 620, fg: "ink", bg: "#FFFFFF", logo: t.logo, corner: 24, quiet: 36, visible: true },
            caption: { type: "text", text: "TO SEE OUR MENU AND BOOK YOUR MEALS", x: 540, y: 1400, size: 34, weight: 700, font: "Sora", align: "center", color: "ink", spacing: 4, w: 900, visible: true },
            shop: { type: "text", text: business.name || "our shop", x: 540, y: 1580, size: 64, weight: 700, font: "Sora", align: "center", color: "ink", spacing: -1, w: 900, visible: true },
            address: { type: "text", text: address || "123 Anywhere St., Any City", x: 540, y: 1660, size: 30, weight: 400, font: "Public Sans", align: "center", color: "ink", w: 820, visible: true },
            contact: { type: "text", text: contact || "+91 98765 43210", x: 540, y: 1720, size: 30, weight: 400, font: "Public Sans", align: "center", color: "ink", w: 820, visible: true },
            cloudL: { type: "shape", shape: "cloud", x: 90, y: 360, size: 150, color: "#FFFFFF", stroke: "ink", visible: true },
            cloudR: { type: "shape", shape: "cloud", x: 980, y: 300, size: 110, color: "#FFFFFF", stroke: "ink", visible: true },
            leafL: { type: "shape", shape: "leaf", x: 60, y: 1830, size: 260, color: "accent", flip: false, visible: true },
            leafR: { type: "shape", shape: "leaf", x: 1020, y: 1830, size: 260, color: "accent", flip: true, visible: true },
        },
    };
}

/**
 * A saved design merged over today's template, so a design saved by an older
 * version (or a partial one) never crashes the editor: any element or field it
 * lacks comes from the default, anything it has wins. Unknown element ids are
 * dropped rather than rendered by a painter that doesn't know them.
 */
export function normalizePoster(saved, business = {}) {
    const base = defaultPoster(business, saved?.theme && THEMES[saved.theme] ? saved.theme : "daisy");
    if (!saved || typeof saved !== "object") return base;
    const elements = {};
    for (const id of Object.keys(base.elements)) {
        const s = saved.elements && typeof saved.elements[id] === "object" ? saved.elements[id] : {};
        elements[id] = { ...base.elements[id], ...s, type: base.elements[id].type };
    }
    const order = Array.isArray(saved.order) ? saved.order.filter((id) => elements[id]) : [];
    for (const id of base.order) if (!order.includes(id)) order.push(id);
    return {
        v: 1,
        theme: base.theme,
        colors: { ...base.colors, ...(saved.colors && typeof saved.colors === "object" ? saved.colors : {}) },
        order,
        elements,
    };
}

/** Re-theme a document but keep text and positions. */
export function applyTheme(poster, themeKey) {
    const t = THEMES[themeKey] || THEMES.daisy;
    const next = JSON.parse(JSON.stringify(poster));
    next.theme = themeKey;
    next.colors = { bg: t.bg, ink: t.ink, accent: t.accent, soft: t.soft };
    if (next.elements.qr) next.elements.qr.logo = t.logo;
    return next;
}

/* ------------------------------------------------------------------ */
/* Painting                                                             */
/* ------------------------------------------------------------------ */
const resolveColor = (c, colors) => (colors[c] !== undefined ? colors[c] : c);

async function ensureFonts() {
    if (typeof document === "undefined" || !document.fonts) return;
    const wanted = ["800 40px Sora", "700 40px Sora", "600 40px Sora", "400 40px 'Public Sans'", "600 40px 'Public Sans'", "400 40px 'IBM Plex Mono'"];
    try { await Promise.all(wanted.map((f) => document.fonts.load(f))); } catch { /* fall back to system fonts */ }
}

function wrapLines(ctx, text, maxWidth) {
    const out = [];
    for (const para of String(text || "").split("\n")) {
        const words = para.split(/\s+/).filter(Boolean);
        let line = "";
        for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            if (maxWidth && ctx.measureText(test).width > maxWidth && line) { out.push(line); line = w; }
            else line = test;
        }
        out.push(line);
    }
    return out;
}

function drawText(ctx, el, colors) {
    const fam = el.font === "Public Sans" ? "'Public Sans'" : el.font === "IBM Plex Mono" ? "'IBM Plex Mono'" : el.font || "Sora";
    ctx.font = `${el.weight || 400} ${el.size}px ${fam}, sans-serif`;
    ctx.fillStyle = resolveColor(el.color, colors);
    ctx.textAlign = el.align || "center";
    ctx.textBaseline = "alphabetic";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${el.spacing || 0}px`;
    const lines = wrapLines(ctx, el.text, el.w);
    const lh = el.size * 1.15;
    let y = el.y;
    let maxW = 0;
    for (const line of lines) {
        ctx.fillText(line, el.x, y);
        maxW = Math.max(maxW, ctx.measureText(line).width + Math.abs(el.spacing || 0) * line.length);
        y += lh;
    }
    const h = lines.length * lh;
    const w = Math.max(maxW, 40);
    const left = el.align === "left" ? el.x : el.align === "right" ? el.x - w : el.x - w / 2;
    return { x: left - 8, y: el.y - el.size * 0.95, w: w + 16, h: h + el.size * 0.15 };
}

function drawCloud(ctx, el, colors) {
    const s = el.size, x = el.x, y = el.y;
    ctx.beginPath();
    ctx.arc(x - s * 0.35, y, s * 0.28, 0, Math.PI * 2);
    ctx.arc(x - s * 0.05, y - s * 0.22, s * 0.36, 0, Math.PI * 2);
    ctx.arc(x + s * 0.3, y - s * 0.05, s * 0.3, 0, Math.PI * 2);
    ctx.rect(x - s * 0.5, y - s * 0.02, s, s * 0.3);
    ctx.closePath();
    ctx.fillStyle = resolveColor(el.color, colors);
    ctx.fill();
    ctx.lineWidth = Math.max(2, s * 0.03);
    ctx.strokeStyle = resolveColor(el.stroke || "ink", colors);
    ctx.stroke();
    return { x: x - s * 0.66, y: y - s * 0.62, w: s * 1.3, h: s * 0.95 };
}

function drawLeaf(ctx, el, colors) {
    const s = el.size, x = el.x, y = el.y, dir = el.flip ? -1 : 1;
    ctx.fillStyle = resolveColor(el.color, colors);
    const leaf = (cx, cy, len, ang, wid) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(wid, -len * 0.5, 0, -len);
        ctx.quadraticCurveTo(-wid, -len * 0.5, 0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    };
    leaf(x, y, s * 0.95, dir * -0.55, s * 0.24);
    leaf(x + dir * s * 0.12, y, s * 0.75, dir * -0.1, s * 0.2);
    leaf(x - dir * s * 0.08, y, s * 0.7, dir * -1.0, s * 0.19);
    leaf(x + dir * s * 0.28, y + s * 0.02, s * 0.5, dir * 0.35, s * 0.15);
    return { x: x - (dir > 0 ? s * 0.55 : s * 0.55), y: y - s, w: s * 1.1, h: s * 1.05 };
}

/** The QR modules, drawn as rounded dots with a clear centre for the logo. */
function drawQr(ctx, el, colors, matrix, logoImg) {
    const size = el.size, quiet = el.quiet ?? 36, r = el.corner ?? 24;
    const left = el.x - size / 2, top = el.y - size / 2;

    // Card behind the code — keeps it scannable on any theme, including dark.
    ctx.fillStyle = el.bg || "#FFFFFF";
    roundRect(ctx, left, top, size, size, r);
    ctx.fill();

    if (!matrix) return { x: left, y: top, w: size, h: size };
    const n = matrix.size;
    const inner = size - quiet * 2;
    const cell = inner / n;
    const fg = resolveColor(el.fg, colors);
    const cx = n / 2, cy = n / 2;
    const clear = el.logo ? n * 0.17 : 0;  // radius in modules kept blank under the logo

    ctx.fillStyle = fg;
    for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
            if (!matrix.get(row, col)) continue;
            if (clear && Math.hypot(col + 0.5 - cx, row + 0.5 - cy) < clear) continue;
            const px = left + quiet + col * cell, py = top + quiet + row * cell;
            const isFinder = (row < 7 && col < 7) || (row < 7 && col >= n - 7) || (row >= n - 7 && col < 7);
            if (isFinder) ctx.fillRect(px, py, cell + 0.4, cell + 0.4);
            else { roundRect(ctx, px + cell * 0.08, py + cell * 0.08, cell * 0.84, cell * 0.84, cell * 0.3); ctx.fill(); }
        }
    }

    if (el.logo) {
        const d = clear * 2 * cell * 0.92;
        const lx = el.x, ly = el.y;
        ctx.fillStyle = el.bg || "#FFFFFF";
        ctx.beginPath(); ctx.arc(lx, ly, d / 2 + cell * 0.6, 0, Math.PI * 2); ctx.fill();
        if (el.logo === "chefo" && logoImg) {
            ctx.save(); ctx.beginPath(); ctx.arc(lx, ly, d / 2, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(logoImg, lx - d / 2, ly - d / 2, d, d); ctx.restore();
        } else if (el.logo !== "chefo") {
            ctx.font = `${d * 0.78}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
            ctx.fillStyle = fg;
            ctx.fillText(el.logo, lx, ly + d * 0.04);
        }
    }
    return { x: left, y: top, w: size, h: size };
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/**
 * Paint the poster onto a canvas at `scale` (1 = full 1080×1920).
 * @returns {Object<string,{x,y,w,h}>} element bounding boxes, in poster px
 */
export async function drawPoster(canvas, poster, { scale = 1, url, logoImg } = {}) {
    await ensureFonts();
    const ctx = canvas.getContext("2d");
    canvas.width = Math.round(POSTER_W * scale);
    canvas.height = Math.round(POSTER_H * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const colors = poster.colors;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);

    // Subtle frame, like the template's inner border.
    ctx.strokeStyle = resolveColor("ink", colors);
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 3;
    roundRect(ctx, 28, 28, POSTER_W - 56, POSTER_H - 56, 36);
    ctx.stroke();
    ctx.globalAlpha = 1;

    let matrix = null;
    if (poster.elements.qr?.visible && url) {
        try { matrix = QRCode.create(url, { errorCorrectionLevel: "H" }).modules; } catch { matrix = null; }
    }

    const boxes = {};
    for (const id of poster.order) {
        const el = poster.elements[id];
        if (!el || el.visible === false) continue;
        ctx.save();
        if (el.type === "text") boxes[id] = drawText(ctx, el, colors);
        else if (el.type === "qr") boxes[id] = drawQr(ctx, el, colors, matrix, logoImg);
        else if (el.type === "shape") boxes[id] = el.shape === "cloud" ? drawCloud(ctx, el, colors) : drawLeaf(ctx, el, colors);
        ctx.restore();
    }
    return boxes;
}

/** Full-resolution PNG blob. */
export async function renderPng(poster, { url, logoImg }) {
    const canvas = document.createElement("canvas");
    await drawPoster(canvas, poster, { scale: 1, url, logoImg });
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Just the code on white, for putting into your own designs. */
export async function renderQrOnly(url, size = 1024) {
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, url, { width: size, margin: 2, errorCorrectionLevel: "H", color: { dark: "#1c2520", light: "#ffffff" } });
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
