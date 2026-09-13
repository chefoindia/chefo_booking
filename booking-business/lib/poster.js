// lib/poster.js — the QR poster: its templates, its themes, its document model,
// and the one function that paints them.
//
// ONE RENDERER FOR PREVIEW AND EXPORT. The editor shows a scaled canvas and
// the download is the same canvas at full size, so what the owner drags into
// place is exactly what prints — no HTML-to-image approximation, no font
// substitution surprises. `drawPoster` also returns every element's bounding
// box, which is what the editor's selection/drag overlay is built from.
//
// TEMPLATE, THEN THEME. A theme is a palette; a TEMPLATE is a layout — its own
// canvas size, its own background chrome, its own set of elements. They are
// separate choices because recolouring must never move anything, and switching
// layout must be allowed to throw the old positions away. Every saved document
// names its template, and `normalizePoster` merges the saved values over THAT
// template's element set rather than over one hardcoded default — which is why
// a design saved in the table-tent layout still opens as a table tent.
//
// `classic` is the original 1080 × 1920 poster, byte-for-byte: same ids, same
// coordinates, same words. A document saved before templates existed has no
// `template` key, reads as classic, and comes back exactly as it was left.
//
// Units are poster pixels, and the poster's size comes from its template — a
// counter card is not a wall poster. POSTER_W / POSTER_H remain exported as
// the classic dimensions so nothing that imported them breaks, but the painter
// asks the template.
import QRCode from "qrcode";
import { BRAND } from "@/lib/brand";

/* ------------------------------------------------------------------ */
/* Themes — the whole palette of a poster in one choice                 */
/* ------------------------------------------------------------------ */
// `onAccent` is the text colour that sits ON an accent band. It is part of the
// theme rather than a literal white because Night's accent is a pale green:
// white-on-pale-green is unreadable, and a reversed-out shop name is the whole
// point of half these layouts.
export const THEMES = {
    daisy: { label: "Daisy", bg: "#FFFCF2", ink: "#3A2B1B", accent: "#2E6B3C", soft: "#EAF3E7", onAccent: "#FFFFFF", qrFg: "#3A2B1B", qrBg: "#FFFFFF", logo: "chefo" },
    basil: { label: "Basil", bg: "#F6F7F5", ink: "#1C2520", accent: "#206E4E", soft: "#E9F3EE", onAccent: "#FFFFFF", qrFg: "#1C2520", qrBg: "#FFFFFF", logo: "chefo" },
    ink: { label: "Night", bg: "#1C2520", ink: "#FFFFFF", accent: "#7FBF93", soft: "#2A3630", onAccent: "#12211A", qrFg: "#1C2520", qrBg: "#FFFFFF", logo: "chefo" },
    sunset: { label: "Turmeric", bg: "#FFF5E8", ink: "#4A2C1A", accent: "#C8871E", soft: "#FBE8C9", onAccent: "#FFFFFF", qrFg: "#4A2C1A", qrBg: "#FFFFFF", logo: "chefo" },
    lake: { label: "Lake", bg: "#EEF2F5", ink: "#1F2D3A", accent: "#3E5C76", soft: "#DCE6EF", onAccent: "#FFFFFF", qrFg: "#1F2D3A", qrBg: "#FFFFFF", logo: "chefo" },
};

export const FONTS = ["Sora", "Public Sans", "IBM Plex Mono", "Georgia", "Arial"];

const PRODUCT = BRAND.productName.toUpperCase();

/* ------------------------------------------------------------------ */
/* Templates — the layouts                                              */
/* ------------------------------------------------------------------ */
// Sizes live up here so a template's chrome() and its build() cannot drift
// apart on what the sheet actually measures.
const SIZE = {
    classic: { w: 1080, h: 1920 },   // 9:16 portrait wall poster
    band: { w: 1240, h: 1754 },      // A4 portrait at ~150dpi
    tent: { w: 1200, h: 1500 },      // 4:5 folded counter card
    menuboard: { w: 1600, h: 1200 }, // 4:3 landscape board
    social: { w: 1080, h: 1080 },    // square, for posting rather than printing
};

export const POSTER_W = SIZE.classic.w;
export const POSTER_H = SIZE.classic.h;

const address = (b) => [b.addressLine, b.city].filter(Boolean).join(", ") || "123 Anywhere St., Any City";
const contact = (b) => [b.contactPhone, b.contactEmail].filter(Boolean).join("  ·  ") || "+91 98765 43210";
const shopName = (b) => b.name || "our shop";

export const TEMPLATES = {
    /* -------------------------------------------------------------- */
    /* Classic — the original poster. Do not "improve" these numbers:  */
    /* every design saved before templates existed is these numbers.   */
    /* -------------------------------------------------------------- */
    classic: {
        key: "classic",
        label: "Classic",
        hint: "Tall wall poster — two big words, code in the middle, shop details at the foot.",
        ...SIZE.classic,
        chrome(ctx, colors) {
            const { w, h } = SIZE.classic;
            ctx.fillStyle = colors.bg;
            ctx.fillRect(0, 0, w, h);
            // Subtle frame, like the template's inner border.
            ctx.strokeStyle = resolveColor("ink", colors);
            ctx.globalAlpha = 0.12;
            ctx.lineWidth = 3;
            roundRect(ctx, 28, 28, w - 56, h - 56, 36);
            ctx.stroke();
            ctx.globalAlpha = 1;
        },
        build(business, themeKey) {
            const t = THEMES[themeKey] || THEMES.daisy;
            return {
                order: ["cloudL", "cloudR", "leafL", "leafR", "brand", "title", "title2", "qr", "caption", "shop", "address", "contact"],
                elements: {
                    brand: { type: "text", label: "Small header", text: PRODUCT, x: 540, y: 110, size: 26, weight: 600, font: "Sora", align: "center", color: "ink", spacing: 8, visible: true },
                    title: { type: "text", label: "Big word 1", text: "scan", x: 540, y: 320, size: 200, weight: 800, font: "Sora", align: "center", color: "ink", spacing: -6, visible: true },
                    title2: { type: "text", label: "Big word 2", text: "here", x: 540, y: 470, size: 200, weight: 800, font: "Sora", align: "center", color: "accent", spacing: -6, visible: true },
                    qr: { type: "qr", label: "QR code", x: 540, y: 960, size: 620, fg: t.qrFg, bg: t.qrBg, logo: t.logo, corner: 24, quiet: 36, visible: true },
                    caption: { type: "text", label: "Call to action", text: "TO SEE OUR MENU AND BOOK YOUR MEALS", x: 540, y: 1400, size: 34, weight: 700, font: "Sora", align: "center", color: "ink", spacing: 4, w: 900, visible: true },
                    shop: { type: "text", label: "Shop name", text: shopName(business), x: 540, y: 1580, size: 64, weight: 700, font: "Sora", align: "center", color: "ink", spacing: -1, w: 900, visible: true },
                    address: { type: "text", label: "Address", text: address(business), x: 540, y: 1660, size: 30, weight: 400, font: "Public Sans", align: "center", color: "ink", w: 820, visible: true },
                    contact: { type: "text", label: "Contact", text: contact(business), x: 540, y: 1720, size: 30, weight: 400, font: "Public Sans", align: "center", color: "ink", w: 820, visible: true },
                    cloudL: { type: "shape", label: "Cloud (left)", shape: "cloud", x: 90, y: 360, size: 150, color: "#FFFFFF", stroke: "ink", visible: true },
                    cloudR: { type: "shape", label: "Cloud (right)", shape: "cloud", x: 980, y: 300, size: 110, color: "#FFFFFF", stroke: "ink", visible: true },
                    leafL: { type: "shape", label: "Leaves (left)", shape: "leaf", x: 60, y: 1830, size: 260, color: "accent", flip: false, visible: true },
                    leafR: { type: "shape", label: "Leaves (right)", shape: "leaf", x: 1020, y: 1830, size: 260, color: "accent", flip: true, visible: true },
                },
            };
        },
    },

    /* -------------------------------------------------------------- */
    /* Band — colour across the top, name reversed out, big QR card    */
    /* -------------------------------------------------------------- */
    band: {
        key: "band",
        label: "Colour band",
        hint: "A4 flyer — bold band with your name reversed out, big code on a white card.",
        ...SIZE.band,
        chrome(ctx, colors) {
            const { w, h } = SIZE.band;
            ctx.fillStyle = colors.bg;
            ctx.fillRect(0, 0, w, h);
        },
        build(business, themeKey) {
            const t = THEMES[themeKey] || THEMES.daisy;
            return {
                order: ["bandTop", "card", "brand", "shop", "logo", "tagline", "qr", "caption", "divider", "address", "contact"],
                elements: {
                    // The band is deep enough, and the shop name small enough,
                    // that a two-line name still reverses out inside it — real
                    // canteen names are long. The tagline sits below the band
                    // rather than under the name for the same reason.
                    bandTop: { type: "shape", label: "Colour band", shape: "band", x: 0, y: 0, w: 1240, h: 440, color: "accent", visible: true },
                    card: { type: "shape", label: "QR card", shape: "card", x: 190, y: 560, w: 860, h: 860, radius: 44, color: "#FFFFFF", visible: true },
                    brand: { type: "text", label: "Small header", text: PRODUCT, x: 620, y: 120, size: 28, weight: 600, font: "Sora", align: "center", color: "onAccent", spacing: 10, visible: true },
                    shop: { type: "text", label: "Shop name", text: shopName(business), x: 620, y: 256, size: 68, weight: 800, font: "Sora", align: "center", color: "onAccent", spacing: -1, w: 1080, visible: true },
                    logo: { type: "image", label: "Your logo", x: 70, y: 50, w: 130, h: 130, radius: 65, visible: Boolean(business.logoUrl) },
                    tagline: { type: "text", label: "Tagline", text: "SCAN TO SEE THE MENU AND BOOK", x: 620, y: 510, size: 32, weight: 600, font: "Sora", align: "center", color: "ink", spacing: 4, w: 1080, visible: true },
                    qr: { type: "qr", label: "QR code", x: 620, y: 990, size: 660, fg: t.qrFg, bg: t.qrBg, logo: t.logo, corner: 24, quiet: 36, visible: true },
                    caption: { type: "text", label: "Call to action", text: "SCAN · CHOOSE · COLLECT", x: 620, y: 1520, size: 42, weight: 800, font: "Sora", align: "center", color: "accent", spacing: 6, w: 1100, visible: true },
                    divider: { type: "shape", label: "Rule", shape: "divider", x: 470, y: 1570, w: 300, thickness: 4, color: "ink", alpha: 0.25, visible: true },
                    address: { type: "text", label: "Address", text: address(business), x: 620, y: 1650, size: 30, weight: 400, font: "Public Sans", align: "center", color: "ink", w: 1040, visible: true },
                    contact: { type: "text", label: "Contact", text: contact(business), x: 620, y: 1700, size: 30, weight: 400, font: "Public Sans", align: "center", color: "ink", w: 1040, visible: true },
                },
            };
        },
    },

    /* -------------------------------------------------------------- */
    /* Tent — the card that stands on a table. Code first, words after */
    /* -------------------------------------------------------------- */
    tent: {
        key: "tent",
        label: "Table tent",
        hint: "Counter card — huge centred code, one line of text, a fold line at the foot.",
        ...SIZE.tent,
        chrome(ctx, colors) {
            const { w, h } = SIZE.tent;
            ctx.fillStyle = colors.bg;
            ctx.fillRect(0, 0, w, h);
            // A thick printed edge: this one gets cut out and folded, so the
            // border is what tells the scissors where the card ends.
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 18;
            roundRect(ctx, 9, 9, w - 18, h - 18, 26);
            ctx.stroke();
        },
        build(business, themeKey) {
            const t = THEMES[themeKey] || THEMES.daisy;
            return {
                order: ["halo", "eyebrow", "shop", "qr", "caption", "dots", "foldNote", "contact"],
                elements: {
                    halo: { type: "shape", label: "Backdrop circle", shape: "circle", x: 600, y: 760, size: 880, color: "soft", visible: true },
                    eyebrow: { type: "text", label: "Eyebrow", text: "SCAN & BOOK", x: 600, y: 210, size: 34, weight: 700, font: "Sora", align: "center", color: "accent", spacing: 14, visible: true },
                    shop: { type: "text", label: "Shop name", text: shopName(business), x: 600, y: 302, size: 58, weight: 800, font: "Sora", align: "center", color: "ink", spacing: -1, w: 1000, visible: true },
                    qr: { type: "qr", label: "QR code", x: 600, y: 760, size: 700, fg: t.qrFg, bg: t.qrBg, logo: t.logo, corner: 28, quiet: 40, visible: true },
                    caption: { type: "text", label: "Call to action", text: "Point your phone camera at the code", x: 600, y: 1250, size: 36, weight: 600, font: "Public Sans", align: "center", color: "ink", w: 1000, visible: true },
                    dots: { type: "shape", label: "Fold line", shape: "dots", x: 110, y: 1320, w: 980, dot: 8, gap: 22, color: "ink", alpha: 0.4, visible: true },
                    foldNote: { type: "text", label: "Fold note", text: "FOLD HERE", x: 600, y: 1385, size: 22, weight: 600, font: "Sora", align: "center", color: "ink", spacing: 8, visible: true },
                    contact: { type: "text", label: "Contact", text: contact(business), x: 600, y: 1450, size: 26, weight: 400, font: "Public Sans", align: "center", color: "ink", w: 1000, visible: true },
                },
            };
        },
    },

    /* -------------------------------------------------------------- */
    /* Menu board — landscape, header strip, code on a card, steps     */
    /* -------------------------------------------------------------- */
    menuboard: {
        key: "menuboard",
        label: "Menu board",
        hint: "Landscape board — dark header strip, code on a white card, numbered steps beside it.",
        ...SIZE.menuboard,
        chrome(ctx, colors) {
            const { w, h } = SIZE.menuboard;
            ctx.fillStyle = colors.bg;
            ctx.fillRect(0, 0, w, h);
            // A soft plinth along the bottom so a wide board does not float.
            ctx.fillStyle = colors.soft;
            ctx.fillRect(0, h - 64, w, 64);
        },
        build(business, themeKey) {
            const t = THEMES[themeKey] || THEMES.daisy;
            return {
                order: ["header", "card", "shop", "brand", "qr", "qrNote", "howTitle", "step1", "step2", "step3", "divider", "address", "contact", "logo"],
                elements: {
                    // The strip is painted in the text colour and the words on
                    // it in the background colour, so it reverses correctly in
                    // every theme, dark ones included.
                    header: { type: "shape", label: "Header strip", shape: "band", x: 0, y: 0, w: 1600, h: 250, color: "ink", visible: true },
                    card: { type: "shape", label: "QR card", shape: "card", x: 90, y: 310, w: 620, h: 780, radius: 36, color: "#FFFFFF", visible: true },
                    shop: { type: "text", label: "Shop name", text: shopName(business), x: 70, y: 148, size: 56, weight: 800, font: "Sora", align: "left", color: "bg", spacing: -1, w: 1080, visible: true },
                    brand: { type: "text", label: "Small header", text: PRODUCT, x: 1530, y: 145, size: 26, weight: 600, font: "Sora", align: "right", color: "bg", spacing: 8, visible: true },
                    qr: { type: "qr", label: "QR code", x: 400, y: 640, size: 520, fg: t.qrFg, bg: t.qrBg, logo: t.logo, corner: 20, quiet: 30, visible: true },
                    qrNote: { type: "text", label: "QR note", text: "Scan with your phone camera", x: 400, y: 1000, size: 30, weight: 600, font: "Public Sans", align: "center", color: "ink", w: 540, visible: true },
                    howTitle: { type: "text", label: "List heading", text: "HOW IT WORKS", x: 780, y: 372, size: 44, weight: 800, font: "Sora", align: "left", color: "accent", spacing: 5, visible: true },
                    step1: { type: "text", label: "Step 1", text: "1.  Scan the code with your phone.", x: 780, y: 480, size: 32, weight: 400, font: "Public Sans", align: "left", color: "ink", w: 760, visible: true },
                    step2: { type: "text", label: "Step 2", text: "2.  Pick a day and a meal.", x: 780, y: 560, size: 32, weight: 400, font: "Public Sans", align: "left", color: "ink", w: 760, visible: true },
                    step3: { type: "text", label: "Step 3", text: "3.  Show your ticket at the counter.", x: 780, y: 640, size: 32, weight: 400, font: "Public Sans", align: "left", color: "ink", w: 760, visible: true },
                    divider: { type: "shape", label: "Rule", shape: "divider", x: 780, y: 710, w: 700, thickness: 3, color: "accent", alpha: 0.5, visible: true },
                    address: { type: "text", label: "Address", text: address(business), x: 780, y: 790, size: 30, weight: 400, font: "Public Sans", align: "left", color: "ink", w: 760, visible: true },
                    contact: { type: "text", label: "Contact", text: contact(business), x: 780, y: 880, size: 30, weight: 400, font: "Public Sans", align: "left", color: "ink", w: 760, visible: true },
                    logo: { type: "image", label: "Your logo", x: 1340, y: 940, w: 160, h: 160, radius: 28, visible: Boolean(business.logoUrl) },
                },
            };
        },
    },

    /* -------------------------------------------------------------- */
    /* Social — the one meant for a screen, not a printer               */
    /* -------------------------------------------------------------- */
    social: {
        key: "social",
        label: "Social square",
        hint: "Square post for WhatsApp or Instagram — colour panel, code on the left, words on the right.",
        ...SIZE.social,
        chrome(ctx, colors) {
            const { w, h } = SIZE.social;
            ctx.fillStyle = colors.bg;
            ctx.fillRect(0, 0, w, h);
        },
        build(business, themeKey) {
            const t = THEMES[themeKey] || THEMES.daisy;
            return {
                order: ["panel", "card", "shop", "tagline", "divider", "brand", "contact", "address", "logo", "qr", "qrNote"],
                elements: {
                    panel: { type: "shape", label: "Colour panel", shape: "band", x: 0, y: 0, w: 460, h: 1080, color: "accent", visible: true },
                    card: { type: "shape", label: "QR card", shape: "card", x: 50, y: 300, w: 360, h: 480, radius: 28, color: "#FFFFFF", visible: true },
                    // The right-hand column is sized for a shop name that runs
                    // to two lines and a contact line that wraps — the common
                    // case, not the short one.
                    shop: { type: "text", label: "Shop name", text: shopName(business), x: 520, y: 320, size: 48, weight: 800, font: "Sora", align: "left", color: "ink", spacing: -1, w: 500, visible: true },
                    tagline: { type: "text", label: "Tagline", text: "See today's menu, book your meal and collect it hot.", x: 520, y: 500, size: 26, weight: 400, font: "Public Sans", align: "left", color: "ink", w: 500, visible: true },
                    divider: { type: "shape", label: "Rule", shape: "divider", x: 520, y: 595, w: 240, thickness: 4, color: "accent", visible: true },
                    brand: { type: "text", label: "Small header", text: PRODUCT, x: 520, y: 655, size: 24, weight: 600, font: "Sora", align: "left", color: "accent", spacing: 8, visible: true },
                    contact: { type: "text", label: "Contact", text: contact(business), x: 520, y: 725, size: 26, weight: 400, font: "Public Sans", align: "left", color: "ink", w: 500, visible: true },
                    address: { type: "text", label: "Address", text: address(business), x: 520, y: 825, size: 26, weight: 400, font: "Public Sans", align: "left", color: "ink", w: 500, visible: true },
                    logo: { type: "image", label: "Your logo", x: 520, y: 900, w: 110, h: 110, radius: 22, visible: Boolean(business.logoUrl) },
                    qr: { type: "qr", label: "QR code", x: 230, y: 505, size: 300, fg: t.qrFg, bg: t.qrBg, logo: t.logo, corner: 18, quiet: 26, visible: true },
                    qrNote: { type: "text", label: "QR note", text: "SCAN ME", x: 230, y: 728, size: 26, weight: 800, font: "Sora", align: "center", color: "ink", spacing: 6, visible: true },
                },
            };
        },
    },
};

export const templateOf = (poster) => TEMPLATES[poster?.template] || TEMPLATES.classic;
/** The sheet this document prints on, in poster pixels. */
export const posterSize = (poster) => { const t = templateOf(poster); return { w: t.w, h: t.h }; };

/* ------------------------------------------------------------------ */
/* The default document — the template the owner starts from           */
/* ------------------------------------------------------------------ */
export function defaultPoster(business = {}, themeKey = "daisy", templateKey = "classic") {
    const t = THEMES[themeKey] || THEMES.daisy;
    const tpl = TEMPLATES[templateKey] || TEMPLATES.classic;
    const { order, elements } = tpl.build(business, THEMES[themeKey] ? themeKey : "daisy");
    return {
        v: 2,
        template: tpl.key,
        theme: THEMES[themeKey] ? themeKey : "daisy",
        colors: { bg: t.bg, ink: t.ink, accent: t.accent, soft: t.soft, onAccent: t.onAccent },
        order,
        elements,
    };
}

/**
 * A saved design merged over its own template, so a design saved by an older
 * version (or a partial one) never crashes the editor: any element or field it
 * lacks comes from the template, anything it has wins. Unknown element ids are
 * dropped rather than rendered by a painter that doesn't know them — which is
 * safe now only because the base is TEMPLATES[saved.template], not one fixed
 * layout. A document with no template is a pre-templates document: classic.
 */
export function normalizePoster(saved, business = {}) {
    const templateKey = saved?.template && TEMPLATES[saved.template] ? saved.template : "classic";
    const themeKey = saved?.theme && THEMES[saved.theme] ? saved.theme : "daisy";
    const base = defaultPoster(business, themeKey, templateKey);
    if (!saved || typeof saved !== "object") return base;
    const elements = {};
    for (const id of Object.keys(base.elements)) {
        const s = saved.elements && typeof saved.elements[id] === "object" ? saved.elements[id] : {};
        elements[id] = { ...base.elements[id], ...s, type: base.elements[id].type, label: base.elements[id].label };
    }
    const order = Array.isArray(saved.order) ? saved.order.filter((id) => elements[id]) : [];
    for (const id of base.order) if (!order.includes(id)) order.push(id);

    // ONE-TIME UPGRADE: a pre-templates document (no `template` key) was saved
    // before the "Centre logo" picker existed, so whatever emoji sits in the
    // middle of its QR came from a theme default — nobody could have chosen it.
    // Those posters get the brand mark, which is what the default should always
    // have been. A document that HAS a template was saved with the picker
    // available, so its choice is a real one and is left alone.
    if (!saved.template && elements.qr && elements.qr.logo && elements.qr.logo !== "chefo") {
        elements.qr = { ...elements.qr, logo: "chefo" };
    }

    return {
        v: 2,
        template: templateKey,
        theme: themeKey,
        colors: { ...base.colors, ...(saved.colors && typeof saved.colors === "object" ? saved.colors : {}) },
        order,
        elements,
    };
}

/** Re-theme a document but keep template, text and positions. */
export function applyTheme(poster, themeKey) {
    const t = THEMES[themeKey] || THEMES.daisy;
    const next = JSON.parse(JSON.stringify(poster));
    next.theme = themeKey;
    next.colors = { bg: t.bg, ink: t.ink, accent: t.accent, soft: t.soft, onAccent: t.onAccent };
    if (next.elements.qr) {
        next.elements.qr.logo = t.logo;
        // The QR's own colours are NOT the theme's ink: Night's ink is white,
        // and white modules on the white card behind them is an unscannable
        // poster. Every theme carries a dedicated dark qrFg for this.
        next.elements.qr.fg = t.qrFg;
        next.elements.qr.bg = t.qrBg;
    }
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

// The business logo is referenced, never embedded: the saved document keeps a
// URL and the bytes are fetched here, at paint time. crossOrigin is set so the
// finished canvas stays exportable — a tainted canvas would break the PNG
// download for the whole poster, so a logo that refuses CORS is treated as no
// logo at all and the placeholder is drawn instead.
const imageCache = new Map();
function loadImage(src) {
    if (!src || typeof window === "undefined") return Promise.resolve(null);
    if (!imageCache.has(src)) {
        imageCache.set(src, new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        }));
    }
    return imageCache.get(src);
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

// Rectangles anchor top-left, round things anchor centre, rules anchor their
// left end — whatever the shape's own numbers mean. What matters to the editor
// is only that every painter hands back the box it actually covered.
function drawBand(ctx, el, colors) {
    const w = Math.max(4, el.w || 0), h = Math.max(4, el.h || 0);
    ctx.globalAlpha = el.alpha ?? 1;
    ctx.fillStyle = resolveColor(el.color, colors);
    ctx.fillRect(el.x, el.y, w, h);
    return { x: el.x, y: el.y, w, h };
}

function drawCard(ctx, el, colors) {
    const w = Math.max(8, el.w || 0), h = Math.max(8, el.h || 0);
    const r = Math.min(el.radius ?? 32, Math.min(w, h) / 2);
    ctx.globalAlpha = el.alpha ?? 1;
    roundRect(ctx, el.x, el.y, w, h, r);
    ctx.fillStyle = resolveColor(el.color, colors);
    ctx.fill();
    if (el.stroke) {
        ctx.lineWidth = el.strokeWidth || 3;
        ctx.strokeStyle = resolveColor(el.stroke, colors);
        ctx.stroke();
    }
    return { x: el.x, y: el.y, w, h };
}

function drawCircle(ctx, el, colors) {
    const r = Math.max(6, el.size || 0) / 2;
    ctx.globalAlpha = el.alpha ?? 1;
    ctx.beginPath();
    ctx.arc(el.x, el.y, r, 0, Math.PI * 2);
    ctx.fillStyle = resolveColor(el.color, colors);
    ctx.fill();
    if (el.stroke) {
        ctx.lineWidth = el.strokeWidth || 3;
        ctx.strokeStyle = resolveColor(el.stroke, colors);
        ctx.stroke();
    }
    return { x: el.x - r, y: el.y - r, w: r * 2, h: r * 2 };
}

function drawDivider(ctx, el, colors) {
    const w = Math.max(20, el.w || 0), t = Math.max(1, el.thickness ?? 4);
    ctx.globalAlpha = el.alpha ?? 1;
    ctx.fillStyle = resolveColor(el.color, colors);
    roundRect(ctx, el.x, el.y - t / 2, w, t, t / 2);
    ctx.fill();
    const hit = Math.max(t, 16);   // a 3px rule is impossible to grab otherwise
    return { x: el.x, y: el.y - hit / 2, w, h: hit };
}

function drawDots(ctx, el, colors) {
    const w = Math.max(20, el.w || 0), d = Math.max(2, el.dot ?? 8), gap = Math.max(d + 2, el.gap ?? 22);
    ctx.globalAlpha = el.alpha ?? 1;
    ctx.fillStyle = resolveColor(el.color, colors);
    for (let x = el.x; x <= el.x + w; x += gap) {
        ctx.beginPath();
        ctx.arc(x, el.y, d / 2, 0, Math.PI * 2);
        ctx.fill();
    }
    const hit = Math.max(d, 16);
    return { x: el.x - d / 2, y: el.y - hit / 2, w: w + d, h: hit };
}

/** The shop's own logo, cover-fitted into its box. */
function drawImage(ctx, el, colors, img) {
    const w = Math.max(20, el.w || 0), h = Math.max(20, el.h || 0);
    const r = Math.min(el.radius ?? 0, Math.min(w, h) / 2);
    if (img && img.width && img.height) {
        ctx.save();
        roundRect(ctx, el.x, el.y, w, h, r);
        ctx.clip();
        const s = Math.max(w / img.width, h / img.height);
        const dw = img.width * s, dh = img.height * s;
        ctx.drawImage(img, el.x + (w - dw) / 2, el.y + (h - dh) / 2, dw, dh);
        ctx.restore();
    } else {
        // No logo on the business (or it wouldn't load): a quiet filled shape
        // rather than a broken-image box, and the owner can simply hide it.
        roundRect(ctx, el.x, el.y, w, h, r);
        ctx.fillStyle = resolveColor(el.placeholder || "soft", colors);
        ctx.fill();
    }
    return { x: el.x, y: el.y, w, h };
}


/** Relative luminance of a #rgb / #rrggbb colour, 0 (black) to 1 (white). */
function luminance(hex) {
    const h = String(hex || "").replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    if (full.length !== 6) return 0;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The colour the QR modules are actually painted in.
 *
 * Scanners need the modules to be much darker than the card behind them. The
 * Night theme's "ink" is white, so a template that pointed the code at the ink
 * token painted white-on-white — a poster that looks fine on screen and cannot
 * be scanned at all. Rather than trust configuration for something this
 * load-bearing, anything without real contrast falls back to near-black.
 */
function readableQrInk(fg, bg) {
    return luminance(bg) - luminance(fg) >= 0.4 ? fg : "#1C2520";
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
    // A QR nobody can scan is a failed poster, so the contrast against the
    // card behind it is enforced here regardless of what was configured.
    const fg = readableQrInk(resolveColor(el.fg, colors), el.bg || "#FFFFFF");
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

const SHAPES = { cloud: drawCloud, leaf: drawLeaf, band: drawBand, card: drawCard, circle: drawCircle, divider: drawDivider, dots: drawDots };

/**
 * Paint the poster onto a canvas at `scale` (1 = the template's own size).
 * @returns {Object<string,{x,y,w,h}>} element bounding boxes, in poster px
 */
export async function drawPoster(canvas, poster, { scale = 1, url, logoImg, logoUrl } = {}) {
    await ensureFonts();
    const tpl = templateOf(poster);
    const ctx = canvas.getContext("2d");
    canvas.width = Math.round(tpl.w * scale);
    canvas.height = Math.round(tpl.h * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const colors = poster.colors;
    // Background and frame belong to the layout, not to the painter: a table
    // tent wants a cut border where a wall poster wants a hairline inset.
    ctx.save();
    tpl.chrome(ctx, colors);
    ctx.restore();

    let matrix = null;
    if (poster.elements.qr?.visible && url) {
        try { matrix = QRCode.create(url, { errorCorrectionLevel: "H" }).modules; } catch { matrix = null; }
    }

    const wantsImage = poster.order.some((id) => poster.elements[id]?.type === "image" && poster.elements[id]?.visible !== false);
    const bizImg = wantsImage ? await loadImage(logoUrl) : null;

    const boxes = {};
    for (const id of poster.order) {
        const el = poster.elements[id];
        if (!el || el.visible === false) continue;
        ctx.save();
        if (el.type === "text") boxes[id] = drawText(ctx, el, colors);
        else if (el.type === "qr") boxes[id] = drawQr(ctx, el, colors, matrix, logoImg);
        else if (el.type === "image") boxes[id] = drawImage(ctx, el, colors, bizImg);
        else if (el.type === "shape") boxes[id] = (SHAPES[el.shape] || drawLeaf)(ctx, el, colors);
        ctx.restore();
    }
    return boxes;
}

/** Full-resolution PNG blob, at whatever size the template prints. */
export async function renderPng(poster, { url, logoImg, logoUrl }) {
    const canvas = document.createElement("canvas");
    await drawPoster(canvas, poster, { scale: 1, url, logoImg, logoUrl });
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Just the code on white, for putting into your own designs. */
export async function renderQrOnly(url, size = 1024) {
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, url, { width: size, margin: 2, errorCorrectionLevel: "H", color: { dark: "#1c2520", light: "#ffffff" } });
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
