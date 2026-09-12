// lib/pdf.js — the shared look of every PDF this dashboard produces.
//
// A kitchen sheet, a weekly menu and a range summary should read as documents
// from one business, so the letterhead, the footer with page numbers and the
// table styling live here. Pages call `openDoc`, add their tables, `closeDoc`.
//
// jsPDF's built-in Helvetica lacks the rupee glyph, so amounts print as
// "Rs 1,240" rather than a box where ₹ should be.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { post } from "@/lib/api";

const INK = [28, 37, 32];
const SLATE = [91, 102, 96];
const FAINT = [138, 148, 142];
const BASIL = [32, 110, 78];
const BORDER = [227, 231, 225];
const PAPER = [246, 247, 245];

export const rs = (n) => `Rs ${Number(n || 0).toLocaleString("en-IN")}`;

/** Landscape or portrait A4 with the business letterhead drawn. */
export function openDoc({ business, title, subtitle, orientation = "portrait" }) {
    const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();

    doc.setFillColor(...PAPER);
    doc.rect(0, 0, W, 78, "F");
    doc.setDrawColor(...BORDER);
    doc.line(0, 78, W, 78);

    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(business?.name || "Chefo Booking", 40, 34);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...SLATE);
    const addr = [business?.addressLine, business?.city].filter(Boolean).join(", ");
    const contact = [addr, business?.contactPhone].filter(Boolean).join("  ·  ");
    if (contact) doc.text(contact, 40, 50);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...BASIL);
    doc.text(title, W - 40, 34, { align: "right" });
    if (subtitle) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...SLATE);
        doc.text(subtitle, W - 40, 50, { align: "right" });
    }
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`, W - 40, 64, { align: "right" });

    doc._chefoY = 100;
    return doc;
}

/** Standard table. Returns the y after it. */
export function table(doc, { head, body, startY, columnStyles = {}, foot, compact = false, theme = "grid" }) {
    autoTable(doc, {
        head: [head], body, foot: foot ? [foot] : undefined,
        startY: startY ?? doc._chefoY,
        theme,
        margin: { left: 40, right: 40 },
        styles: { font: "helvetica", fontSize: compact ? 8 : 9, cellPadding: compact ? 3 : 5, textColor: INK, lineColor: BORDER, lineWidth: 0.5 },
        headStyles: { fillColor: PAPER, textColor: SLATE, fontStyle: "bold", fontSize: 8, halign: "left" },
        footStyles: { fillColor: [233, 243, 238], textColor: [24, 90, 64], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [252, 252, 251] },
        columnStyles,
        didDrawPage: () => footer(doc),
    });
    doc._chefoY = doc.lastAutoTable.finalY + 18;
    return doc._chefoY;
}

/** A small heading line above a table. */
export function heading(doc, text, sub) {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    if (doc._chefoY > H - 120) { doc.addPage(); doc._chefoY = 60; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(text, 40, doc._chefoY);
    if (sub) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...SLATE);
        doc.text(sub, W - 40, doc._chefoY, { align: "right" });
    }
    doc._chefoY += 10;
}

/** Big-number tiles in a row — the kitchen reads these from across the room. */
export function tiles(doc, items) {
    const W = doc.internal.pageSize.getWidth();
    const w = (W - 80 - (items.length - 1) * 10) / items.length;
    const y = doc._chefoY;
    items.forEach((it, i) => {
        const x = 40 + i * (w + 10);
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...BORDER);
        doc.roundedRect(x, y, w, 52, 6, 6, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.setTextColor(...(it.tone === "amber" ? [154, 107, 21] : INK));
        doc.text(String(it.value), x + 12, y + 30);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...FAINT);
        doc.text(String(it.label).toUpperCase(), x + 12, y + 43);
    });
    doc._chefoY = y + 70;
}

function footer(doc) {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...FAINT);
    doc.text("Chefo Booking — counts include confirmed bookings only; pending requests are never added in.", 40, H - 22);
    doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, W - 40, H - 22, { align: "right" });
}

/** Save, and tell the server so the export is on the record. */
export async function closeDoc(doc, filename, audit) {
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) { doc.setPage(p); footer(doc); }
    doc.save(filename);
    if (audit) {
        try { await post("/api/reports/exported", audit); } catch { /* the download already happened */ }
    }
}
