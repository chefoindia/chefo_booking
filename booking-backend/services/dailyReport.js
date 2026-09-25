// services/dailyReport.js — the day's bookings, as a formal email with the
// kitchen sheet attached as a PDF.
//
// THREE JOBS, ONE FILE, so the email and the attachment can never describe a
// different day from each other:
//
//   buildDayReport()   the numbers. Every count comes from services/quantity.js,
//                      the same function the dashboard and the reports page
//                      read, so the figure in the owner's inbox is the figure on
//                      the kitchen wall. Nothing is re-summed here.
//   renderEmail()      the message body. Written like a letter from the
//                      office, not a marketing mail: what happened, in tables,
//                      with the attachment named and a line saying why the
//                      recipient is getting it.
//   renderPdf()        the attachment, drawn server-side with pdfkit. The
//                      dashboard draws its PDFs in the browser with jsPDF; that
//                      cannot run on a schedule at nine at night, so the report
//                      has its own renderer and mirrors the dashboard's layout.
//
// sendDailyReport() ties them together and is what both the scheduler and the
// "Send now" button call, so a test send is the real thing, not a facsimile.
const PDFDocument = require("pdfkit");

const Business = require("../models/Business");
const Booking = require("../models/Booking");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const Outlet = require("../models/Outlet");
const { confirmedTotalsByMeal, confirmedTotalsByOutlet, orderVariants } = require("./quantity");
const {
    cutoffState, todayKey, shiftDateKey, formatDateKey, formatTimeOfDay, formatInstant, zoneLabel, isDateKey,
} = require("../utils/time");
const { BRAND } = require("../config/brand");
const mailer = require("./mailer");
const { record } = require("./audit");

const inr = (n) => Number(n || 0).toLocaleString("en-IN");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const prettyPhone = (p) => {
    const m = String(p || "").match(/^\+(\d{1,3})(\d{5})(\d{5})$/);
    return m ? `+${m[1]} ${m[2]} ${m[3]}` : String(p || "");
};
const STATUS_LABEL = { confirmed: "Confirmed", pending_approval: "Awaiting approval", rejected: "Rejected", cancelled: "Cancelled" };

/* ------------------------------------------------------------------ */
/* THE NUMBERS                                                          */
/* ------------------------------------------------------------------ */
/**
 * Everything the report says about one business on one date.
 *
 * Canteen-wide on purpose: this is the owner's document, and the owner is
 * never outlet-restricted. Outlets appear as a breakdown, never as a filter.
 *
 * @param {object} opts
 *   businessId   required
 *   date         "YYYY-MM-DD" in the business zone; defaults to today there
 *   now          injected clock (tests)
 */
async function buildDayReport({ businessId, date, now = new Date() }) {
    const business = await Business.findById(businessId).lean();
    if (!business) throw Object.assign(new Error("Business not found."), { status: 404 });
    const tz = business.timezoneOffsetMinutes ?? 330;
    const today = todayKey(tz, now);
    const day = isDateKey(date) ? date : today;
    const tomorrow = shiftDateKey(day, 1);

    const [mealTypes, variants, outlets, confirmed, byOutletRaw, bookings, tomorrowConfirmed] = await Promise.all([
        MealType.find({ businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
        MealVariant.find({ businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
        Outlet.find({ businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
        confirmedTotalsByMeal({ businessId, date: day }),
        confirmedTotalsByOutlet({ businessId, date: day }),
        Booking.find({ businessId, date: day }).sort({ mealTypeId: 1, outletName: 1, "partySnapshot.name": 1 }).lean(),
        confirmedTotalsByMeal({ businessId, date: tomorrow }),
    ]);

    const relevantVariants = (mealTypeId) =>
        variants.filter((v) => !v.mealTypeIds?.length || v.mealTypeIds.some((id) => String(id) === String(mealTypeId)));

    const services = mealTypes.map((m) => {
        const key = String(m._id);
        const conf = confirmed.get(key) || { byVariant: {}, totalQuantity: 0, bookingCount: 0 };
        const mine = bookings.filter((b) => String(b.mealTypeId) === key);
        const live = mine.filter((b) => b.status === "confirmed");
        const served = live.filter((b) => b.consumedAt);
        const late = live.filter((b) => b.submittedAfterCutoff);
        const cancelled = mine.filter((b) => b.status === "cancelled");
        return {
            mealTypeId: m._id, name: m.name, active: m.active !== false,
            startTime: m.startTime || "", endTime: m.endTime || "",
            cutoff: cutoffState(m, day, { now, offsetMinutes: tz }),
            confirmed: {
                byVariant: orderVariants(conf.byVariant, relevantVariants(m._id)),
                totalQuantity: conf.totalQuantity,
                bookingCount: conf.bookingCount,
            },
            amount: live.reduce((n, b) => n + (b.totalAmount || 0), 0),
            served: { bookings: served.length, quantity: served.reduce((n, b) => n + (b.totalQuantity || 0), 0) },
            awaiting: { bookings: live.length - served.length, quantity: conf.totalQuantity - served.reduce((n, b) => n + (b.totalQuantity || 0), 0) },
            late: { bookings: late.length, quantity: late.reduce((n, b) => n + (b.totalQuantity || 0), 0) },
            cancelled: { bookings: cancelled.length, quantity: cancelled.reduce((n, b) => n + (b.totalQuantity || 0), 0) },
            bySource: {
                customer: live.filter((b) => b.source !== "operator").length,
                operator: live.filter((b) => b.source === "operator").length,
            },
            bookings: mine.map((b) => ({
                id: String(b._id), reference: b.reference, status: b.status,
                customer: b.partySnapshot?.name || "", phone: b.partySnapshot?.phone || "",
                organisation: b.partySnapshot?.organisation || "", partyType: b.partySnapshot?.partyType || "",
                outletName: b.outletName || "",
                lines: (b.lines || []).map((l) => ({ variantName: l.variantName, quantity: l.quantity })),
                totalQuantity: b.totalQuantity || 0, totalAmount: b.totalAmount || 0,
                source: b.source || "customer", submittedAfterCutoff: Boolean(b.submittedAfterCutoff),
                consumedAt: b.consumedAt || null, consumedByName: b.consumedByName || "",
                customerNote: b.customerNote || "", location: b.location || "",
                answers: (b.answers || []).map((a) => ({ label: a.label, value: a.value })),
                createdAt: b.createdAt,
            })),
        };
    })
        // Inactive services with nothing on the day are noise; anything with a
        // booking is shown even if the service has since been switched off.
        .filter((s) => s.active || s.bookings.length);

    // Per outlet, from the same rows — the lines add up to the overall by
    // construction (see quantity.js), and are never used to compute it.
    let byOutlet = null;
    if (outlets.length || byOutletRaw.has("unassigned")) {
        const line = (key, name, active) => {
            const o = byOutletRaw.get(key);
            return {
                name, active,
                totalQuantity: o?.totalQuantity || 0, bookingCount: o?.bookingCount || 0,
                services: services.map((s) => {
                    const mm = o?.byMeal.get(String(s.mealTypeId));
                    return { name: s.name, totalQuantity: mm?.totalQuantity || 0, bookingCount: mm?.bookingCount || 0 };
                }),
            };
        };
        byOutlet = outlets.map((o) => line(String(o._id), o.name, o.active !== false));
        const un = byOutletRaw.get("unassigned");
        if (un && (un.totalQuantity || un.bookingCount)) byOutlet.push(line("unassigned", "Unassigned (before outlets)", true));
    }

    const liveAll = bookings.filter((b) => b.status === "confirmed");
    const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
    const totals = {
        confirmedQuantity: sum(services, (s) => s.confirmed.totalQuantity),
        bookings: sum(services, (s) => s.confirmed.bookingCount),
        amount: sum(services, (s) => s.amount),
        served: { bookings: sum(services, (s) => s.served.bookings), quantity: sum(services, (s) => s.served.quantity) },
        awaiting: { bookings: sum(services, (s) => s.awaiting.bookings), quantity: sum(services, (s) => s.awaiting.quantity) },
        late: { bookings: sum(services, (s) => s.late.bookings), quantity: sum(services, (s) => s.late.quantity) },
        cancelled: { bookings: sum(services, (s) => s.cancelled.bookings), quantity: sum(services, (s) => s.cancelled.quantity) },
        customers: new Set(liveAll.map((b) => b.partySnapshot?.phone || String(b.partyId))).size,
        bySource: { customer: sum(services, (s) => s.bySource.customer), operator: sum(services, (s) => s.bySource.operator) },
    };

    const tomorrowServices = mealTypes.filter((m) => m.active !== false).map((m) => {
        const c = tomorrowConfirmed.get(String(m._id)) || { byVariant: {}, totalQuantity: 0, bookingCount: 0 };
        return {
            name: m.name, totalQuantity: c.totalQuantity, bookingCount: c.bookingCount,
            byVariant: orderVariants(c.byVariant, relevantVariants(m._id)).filter((v) => v.quantity > 0),
        };
    });

    return {
        business: {
            id: String(business._id), name: business.name, slug: business.slug,
            addressLine: business.addressLine || "", city: business.city || "",
            contactPhone: business.contactPhone || "", contactEmail: business.contactEmail || "",
        },
        tz, zone: zoneLabel(tz),
        date: day, dateLabel: formatDateKey(day), isToday: day === today,
        generatedAt: now, generatedLabel: formatInstant(now, tz),
        services, byOutlet, totals,
        hasOutlets: outlets.length > 0,
        hasPrices: totals.amount > 0 || variants.some((v) => v.price > 0),
        tomorrow: {
            date: tomorrow, dateLabel: formatDateKey(tomorrow),
            confirmedQuantity: sum(tomorrowServices, (s) => s.totalQuantity),
            bookings: sum(tomorrowServices, (s) => s.bookingCount),
            services: tomorrowServices,
        },
    };
}

/* ------------------------------------------------------------------ */
/* THE EMAIL                                                            */
/* ------------------------------------------------------------------ */
// Table-based HTML with every style inline, because that is what email
// clients render reliably. One column, restrained palette, no imagery — it is
// a report, and it should read like one on a phone at nine at night.
const C = {
    ink: "#1c2520", slate: "#5b6660", faint: "#8a948e", border: "#e3e7e1", paper: "#f6f7f5",
    basil: "#206e4e", basilDark: "#185a40", basilSoft: "#e9f3ee", amber: "#9a6b15", amberSoft: "#f8f0df", brick: "#ae3b32",
};
const FONT = "'Public Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const th = (t, align = "left") =>
    `<th align="${align}" style="padding:8px 10px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${C.slate};background:${C.paper};border-bottom:1px solid ${C.border};text-align:${align};">${esc(t)}</th>`;
const td = (t, { align = "left", strong = false, muted = false, nowrap = false } = {}) =>
    `<td align="${align}" style="padding:9px 10px;font-size:13.5px;color:${muted ? C.slate : C.ink};${strong ? "font-weight:700;" : ""}${nowrap ? "white-space:nowrap;" : ""}border-bottom:1px solid ${C.border};vertical-align:top;text-align:${align};">${t}</td>`;
const tableWrap = (rows) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid ${C.border};border-radius:8px;overflow:hidden;margin:0 0 18px;">${rows}</table>`;
const h2 = (t) => `<h2 style="margin:22px 0 8px;font-family:${FONT};font-size:15px;font-weight:700;color:${C.ink};">${esc(t)}</h2>`;
const p = (t, extra = "") => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${C.ink};${extra}">${t}</p>`;

function tile(label, value, sub = "", tone = "") {
    const color = tone === "amber" ? C.amber : tone === "red" ? C.brick : C.ink;
    return `<td width="33%" valign="top" style="padding:6px;">
      <div style="border:1px solid ${C.border};border-radius:8px;padding:12px 14px;background:#ffffff;">
        <div style="font-family:${FONT};font-size:22px;font-weight:700;color:${color};line-height:1.1;">${esc(value)}</div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${C.faint};margin-top:5px;">${esc(label)}</div>
        ${sub ? `<div style="font-size:12px;color:${C.slate};margin-top:3px;">${esc(sub)}</div>` : ""}
      </div></td>`;
}

/**
 * @param report   from buildDayReport()
 * @param opts     { attachPdf, includeTomorrow, pdfName }
 */
function renderEmail(report, { attachPdf = true, includeTomorrow = true, pdfName = "" } = {}) {
    const r = report;
    const t = r.totals;
    const subject = `Daily Booking Report — ${r.business.name} — ${r.dateLabel}`;
    const window = (s) => (s.startTime && s.endTime ? `${formatTimeOfDay(s.startTime)} – ${formatTimeOfDay(s.endTime)}` : "—");
    const cutoff = (s) => (s.cutoff.hasCutoff
        ? `${s.cutoff.passed ? "Closed" : "Open until"} ${formatTimeOfDay(s.cutoff.cutoffTime)}${s.cutoff.cutoffDate !== r.date ? " (previous day)" : ""}`
        : "No cutoff");
    const breakdown = (s) => s.confirmed.byVariant.filter((v) => v.quantity > 0).map((v) => `${v.quantity} ${esc(v.variantName)}`).join(" · ") || "—";

    const intro = t.bookings === 0
        ? `No confirmed bookings were recorded for ${r.dateLabel}.${t.cancelled.bookings ? ` ${plural(t.cancelled.bookings, "booking")} ${t.cancelled.bookings === 1 ? "was" : "were"} cancelled.` : ""}`
        : `On ${r.dateLabel}, ${r.business.name} received <strong>${plural(t.bookings, "confirmed booking")}</strong> for a total of <strong>${plural(t.confirmedQuantity, "meal")}</strong>`
        + ` across ${plural(r.services.filter((s) => s.confirmed.bookingCount).length, "meal service")}`
        + `${t.served.bookings ? `, of which ${plural(t.served.bookings, "booking")} (${plural(t.served.quantity, "meal")}) ${t.served.bookings === 1 ? "was" : "were"} collected at the counter` : ""}.`
        + `${t.late.bookings ? ` ${plural(t.late.bookings, "booking")} ${t.late.bookings === 1 ? "was" : "were"} entered after the booking cutoff.` : ""}`
        + `${t.cancelled.bookings ? ` ${plural(t.cancelled.bookings, "booking")} ${t.cancelled.bookings === 1 ? "was" : "were"} cancelled and ${t.cancelled.bookings === 1 ? "is" : "are"} not included in the totals.` : ""}`;

    const tiles = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;margin:0 -6px 8px;"><tr>
        ${tile("Meals booked", inr(t.confirmedQuantity), `${plural(t.bookings, "booking")}`)}
        ${tile("Collected", inr(t.served.quantity), `${plural(t.served.bookings, "booking")} served`)}
        ${tile("Awaiting collection", inr(t.awaiting.quantity), `${plural(t.awaiting.bookings, "booking")}`, t.awaiting.bookings && r.isToday ? "amber" : "")}
      </tr><tr>
        ${r.hasPrices ? tile("Confirmed amount", `₹${inr(t.amount)}`, "confirmed bookings only") : tile("Customers", inr(t.customers), "distinct booking parties")}
        ${tile("After cutoff", inr(t.late.bookings), t.late.bookings ? `${plural(t.late.quantity, "meal")} taken late` : "none", t.late.bookings ? "amber" : "")}
        ${tile("Cancelled", inr(t.cancelled.bookings), t.cancelled.bookings ? `${plural(t.cancelled.quantity, "meal")} released` : "none")}
      </tr></table>`;

    const serviceRows = r.services.map((s) => `<tr>
        ${td(`<strong>${esc(s.name)}</strong><div style="font-size:12px;color:${C.slate};margin-top:2px;">Served ${window(s)} · ${cutoff(s)}</div>`)}
        ${td(String(s.confirmed.bookingCount), { align: "right" })}
        ${td(String(s.confirmed.totalQuantity), { align: "right", strong: true })}
        ${td(breakdown(s), { muted: true })}
        ${td(s.confirmed.bookingCount ? `${s.served.quantity} / ${s.confirmed.totalQuantity}` : "—", { align: "right", nowrap: true })}
        ${r.hasPrices ? td(s.amount ? `₹${inr(s.amount)}` : "—", { align: "right", nowrap: true }) : ""}
      </tr>`).join("");
    const servicesTable = tableWrap(`<tr>${th("Meal service")}${th("Bookings", "right")}${th("Meals", "right")}${th("Breakdown by option")}${th("Collected", "right")}${r.hasPrices ? th("Amount", "right") : ""}</tr>${serviceRows}
      <tr style="background:${C.basilSoft};">
        ${td("<strong>Total</strong>")}${td(`<strong>${t.bookings}</strong>`, { align: "right" })}${td(`<strong>${t.confirmedQuantity}</strong>`, { align: "right" })}${td("")}${td(`<strong>${t.served.quantity} / ${t.confirmedQuantity}</strong>`, { align: "right", nowrap: true })}${r.hasPrices ? td(`<strong>₹${inr(t.amount)}</strong>`, { align: "right", nowrap: true }) : ""}
      </tr>`);

    const outletTable = r.byOutlet ? tableWrap(`<tr>${th("Outlet")}${r.services.map((s) => th(s.name, "right")).join("")}${th("Meals", "right")}${th("Bookings", "right")}</tr>`
        + r.byOutlet.map((o) => `<tr>
            ${td(`${esc(o.name)}${o.active ? "" : ` <span style="font-size:11px;color:${C.faint};">(inactive)</span>`}`)}
            ${o.services.map((s) => td(String(s.totalQuantity), { align: "right", muted: !s.totalQuantity })).join("")}
            ${td(String(o.totalQuantity), { align: "right", strong: true })}
            ${td(String(o.bookingCount), { align: "right" })}
          </tr>`).join("")) : "";

    const tomorrowBlock = includeTomorrow ? (() => {
        const tm = r.tomorrow;
        if (!tm.bookings) return h2(`Outlook for ${tm.dateLabel}`) + p(`No bookings have been confirmed yet for ${tm.dateLabel}.`, `color:${C.slate};`);
        return h2(`Outlook for ${tm.dateLabel}`)
            + p(`<strong>${plural(tm.confirmedQuantity, "meal")}</strong> across ${plural(tm.bookings, "booking")} ${tm.bookings === 1 ? "has" : "have"} already been confirmed. Bookings remain open until each service's cutoff, so these figures may rise.`)
            + tableWrap(`<tr>${th("Meal service")}${th("Bookings", "right")}${th("Meals so far", "right")}${th("Breakdown by option")}</tr>`
                + tm.services.map((s) => `<tr>${td(esc(s.name))}${td(String(s.bookingCount), { align: "right" })}${td(String(s.totalQuantity), { align: "right", strong: true })}${td(s.byVariant.map((v) => `${v.quantity} ${esc(v.variantName)}`).join(" · ") || "—", { muted: true })}</tr>`).join(""));
    })() : "";

    const attachmentLine = attachPdf
        ? `The complete booking sheet for the day — every booking by service, with customer, outlet, quantities, status and collection — is attached to this email as <strong>${esc(pdfName || `daily-report-${r.date}.pdf`)}</strong>.`
        : "The complete booking sheet for the day is available under Reports in your dashboard.";

    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:${C.paper};font-family:${FONT};color:${C.ink};">
  <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;">
      <div style="font-family:Sora,${FONT};font-weight:700;font-size:18px;color:${C.ink};">Chef<span style="color:${C.basil};">o</span> <span style="font-weight:500;color:${C.slate};font-size:14px;">${esc(BRAND.shortName)}</span></div>
    </div>
    <div style="background:#ffffff;border:1px solid ${C.border};border-radius:12px;padding:26px 24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.basil};">Daily Booking Report</div>
      <h1 style="margin:4px 0 2px;font-family:Sora,${FONT};font-size:21px;font-weight:700;color:${C.ink};">${esc(r.business.name)}</h1>
      <div style="font-size:14px;color:${C.slate};margin-bottom:18px;">${esc(r.dateLabel)}${r.byOutlet ? " · all outlets" : ""}</div>

      ${p(`Dear Team,`)}
      ${p(`Please find below the daily booking report for <strong>${esc(r.dateLabel)}</strong>. ${intro}`)}
      ${p(attachmentLine, `color:${C.slate};font-size:13.5px;`)}

      ${h2("Summary")}
      ${tiles}

      ${h2("By meal service")}
      ${servicesTable}

      ${r.byOutlet ? h2("By outlet") + outletTable : ""}

      ${tomorrowBlock}

      <div style="margin-top:20px;padding:12px 14px;border-radius:8px;background:${C.paper};border:1px solid ${C.border};font-size:12.5px;line-height:1.55;color:${C.slate};">
        Counts include confirmed bookings only. Cancelled bookings are listed in the attached sheet for reference and are never added to preparation totals. "Collected" reflects tickets scanned or marked served at the counter up to the time this report was generated.
      </div>

      ${p(`Kind regards,<br>${esc(BRAND.productName)} — automated reporting for ${esc(r.business.name)}`, "margin-top:22px;")}
    </div>
    <p style="font-size:12px;line-height:1.6;color:${C.faint};margin:16px 4px 0;">
      Generated ${esc(r.generatedLabel)}. You are receiving this because your address is listed under Settings → Daily report in the ${esc(BRAND.productName)} dashboard for ${esc(r.business.name)}. The delivery time, recipients and contents can be changed there by the business owner.
    </p>
  </div>
</body></html>`;

    const textLines = [
        `DAILY BOOKING REPORT — ${r.business.name} — ${r.dateLabel}`,
        "",
        `Dear Team,`,
        "",
        `Please find below the daily booking report for ${r.dateLabel}. ${intro.replace(/<[^>]+>/g, "")}`,
        "",
        `SUMMARY`,
        `  Meals booked:        ${t.confirmedQuantity} (${plural(t.bookings, "booking")})`,
        `  Collected:           ${t.served.quantity} meals / ${plural(t.served.bookings, "booking")}`,
        `  Awaiting collection: ${t.awaiting.quantity} meals / ${plural(t.awaiting.bookings, "booking")}`,
        ...(r.hasPrices ? [`  Confirmed amount:    Rs ${inr(t.amount)}`] : []),
        `  After cutoff:        ${plural(t.late.bookings, "booking")}`,
        `  Cancelled:           ${plural(t.cancelled.bookings, "booking")}`,
        "",
        `BY MEAL SERVICE`,
        ...r.services.map((s) => `  ${s.name}: ${plural(s.confirmed.bookingCount, "booking")}, ${plural(s.confirmed.totalQuantity, "meal")} (${breakdown(s).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")}), collected ${s.served.quantity}/${s.confirmed.totalQuantity}`),
        ...(r.byOutlet ? ["", "BY OUTLET", ...r.byOutlet.map((o) => `  ${o.name}: ${plural(o.totalQuantity, "meal")}, ${plural(o.bookingCount, "booking")}`)] : []),
        ...(includeTomorrow ? ["", `OUTLOOK FOR ${r.tomorrow.dateLabel.toUpperCase()}`, `  ${plural(r.tomorrow.confirmedQuantity, "meal")} across ${plural(r.tomorrow.bookings, "booking")} confirmed so far.`] : []),
        "",
        attachmentLine.replace(/<[^>]+>/g, ""),
        "",
        `Counts include confirmed bookings only.`,
        "",
        `Kind regards,`,
        `${BRAND.productName} — automated reporting for ${r.business.name}`,
        "",
        `Generated ${r.generatedLabel}. Change the schedule or recipients under Settings → Daily report.`,
    ];

    return { subject, html, text: textLines.join("\n") };
}

/* ------------------------------------------------------------------ */
/* THE PDF                                                              */
/* ------------------------------------------------------------------ */
// A4 portrait, the dashboard's letterhead, and one table renderer used for
// every table so they all break across pages the same way. Helvetica has no
// rupee glyph, so amounts print as "Rs 1,240" exactly as the dashboard's PDFs
// do.
const INK = "#1c2520", SLATE = "#5b6660", FAINT = "#8a948e", BASIL = "#206e4e", BORDER = "#e3e7e1", PAPER = "#f6f7f5", SOFT = "#e9f3ee", AMBER = "#9a6b15";
const M = 40;                       // page margin
const rs = (n) => `Rs ${inr(n)}`;

function pdfTable(doc, { columns, rows, foot = null, zebra = true, fontSize = 8.5 }) {
    const W = doc.page.width - M * 2;
    const H = doc.page.height;
    const fixed = columns.reduce((n, c) => n + (c.width || 0), 0);
    const flex = columns.filter((c) => !c.width).length;
    const flexW = flex ? Math.max(40, (W - fixed) / flex) : 0;
    const widths = columns.map((c) => c.width || flexW);
    const pad = 4;

    const cellHeight = (text, i, size) => {
        doc.fontSize(size);
        return doc.heightOfString(String(text ?? ""), { width: widths[i] - pad * 2 }) + pad * 2;
    };
    const drawRow = (cells, { head = false, fill = null, bold = false, size = fontSize } = {}) => {
        doc.font(bold || head ? "Helvetica-Bold" : "Helvetica");
        const h = Math.max(...cells.map((c, i) => cellHeight(c, i, head ? 7.5 : size)), 16);
        if (doc.y + h > H - 60) { doc.addPage(); doc.y = M + 20; if (!head) drawRow(columns.map((c) => c.label), { head: true }); }
        const y = doc.y;
        if (head) { doc.rect(M, y, W, h).fill(PAPER); }
        else if (fill) { doc.rect(M, y, W, h).fill(fill); }
        let x = M;
        cells.forEach((c, i) => {
            doc.fillColor(head ? SLATE : INK).fontSize(head ? 7.5 : size);
            doc.text(String(c ?? ""), x + pad, y + pad, { width: widths[i] - pad * 2, align: columns[i].align || "left", lineBreak: true });
            x += widths[i];
        });
        doc.moveTo(M, y + h).lineTo(M + W, y + h).lineWidth(0.5).strokeColor(BORDER).stroke();
        doc.y = y + h;
        doc.x = M;
    };

    // Never leave a header orphaned at the foot of a page: it needs room for
    // itself and at least one row.
    if (doc.y > H - 110) { doc.addPage(); doc.y = M + 20; }
    doc.moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(0.5).strokeColor(BORDER).stroke();
    drawRow(columns.map((c) => c.label), { head: true });
    rows.forEach((r, i) => drawRow(r, { fill: zebra && i % 2 === 1 ? "#fbfbfa" : null }));
    if (foot) drawRow(foot, { fill: SOFT, bold: true });
    doc.y += 14;
}

function pdfHeading(doc, text, sub = "") {
    const H = doc.page.height;
    if (doc.y > H - 140) { doc.addPage(); doc.y = M + 20; }
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(text, M, doc.y, { continued: Boolean(sub) });
    if (sub) doc.font("Helvetica").fontSize(8.5).fillColor(SLATE).text(`   ${sub}`);
    doc.y += 6;
    doc.x = M;
}

function pdfTiles(doc, items) {
    const W = doc.page.width - M * 2;
    const gap = 8;
    const w = (W - gap * (items.length - 1)) / items.length;
    const y = doc.y;
    items.forEach((it, i) => {
        const x = M + i * (w + gap);
        doc.roundedRect(x, y, w, 50, 6).lineWidth(0.6).fillAndStroke("#ffffff", BORDER);
        doc.font("Helvetica-Bold").fontSize(16).fillColor(it.tone === "amber" ? AMBER : INK).text(String(it.value), x + 10, y + 11, { width: w - 20, lineBreak: false });
        doc.font("Helvetica").fontSize(6.8).fillColor(FAINT).text(String(it.label).toUpperCase(), x + 10, y + 33, { width: w - 20, lineBreak: false });
    });
    doc.y = y + 66;
    doc.x = M;
}

function pdfLetterhead(doc, report, { title, subtitle }) {
    const W = doc.page.width;
    doc.rect(0, 0, W, 76).fill(PAPER);
    doc.moveTo(0, 76).lineTo(W, 76).lineWidth(0.6).strokeColor(BORDER).stroke();
    doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(report.business.name, M, 26, { width: W / 2, lineBreak: false });
    const addr = [report.business.addressLine, report.business.city].filter(Boolean).join(", ");
    const contact = [addr, report.business.contactPhone].filter(Boolean).join("   ·   ");
    if (contact) doc.font("Helvetica").fontSize(8.5).fillColor(SLATE).text(contact, M, 46, { width: W / 2, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor(BASIL).text(title, W / 2, 26, { width: W / 2 - M, align: "right", lineBreak: false });
    doc.font("Helvetica").fontSize(8.5).fillColor(SLATE).text(subtitle, W / 2, 43, { width: W / 2 - M, align: "right", lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor(FAINT).text(`Generated ${report.generatedLabel}`, W / 2, 57, { width: W / 2 - M, align: "right", lineBreak: false });
    doc.y = 96;
    doc.x = M;
}

/**
 * @returns {Promise<Buffer>}
 */
function renderPdf(report, { includeBookingList = true, includeTomorrow = true } = {}) {
    return new Promise((resolve, reject) => {
        const r = report;
        const t = r.totals;
        const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: `Daily Booking Report — ${r.business.name} — ${r.dateLabel}`, Author: BRAND.productName } });
        const chunks = [];
        doc.on("data", (c) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        pdfLetterhead(doc, r, { title: "Daily Booking Report", subtitle: `${r.dateLabel}${r.byOutlet ? "  ·  all outlets" : ""}` });

        pdfTiles(doc, [
            { label: "Meals booked", value: inr(t.confirmedQuantity) },
            { label: "Bookings", value: inr(t.bookings) },
            { label: "Collected", value: `${inr(t.served.quantity)} / ${inr(t.confirmedQuantity)}` },
            { label: "After cutoff", value: inr(t.late.bookings), tone: t.late.bookings ? "amber" : "" },
            { label: "Cancelled", value: inr(t.cancelled.bookings) },
            ...(r.hasPrices ? [{ label: "Amount", value: rs(t.amount) }] : [{ label: "Customers", value: inr(t.customers) }]),
        ]);

        // Overview table
        pdfHeading(doc, "By meal service");
        pdfTable(doc, {
            columns: [
                { label: "Meal service" }, { label: "Served", width: 96 }, { label: "Cutoff", width: 88 },
                { label: "Bookings", width: 46, align: "right" }, { label: "Meals", width: 40, align: "right" },
                { label: "Breakdown by option" }, { label: "Collected", width: 54, align: "right" },
                ...(r.hasPrices ? [{ label: "Amount", width: 60, align: "right" }] : []),
            ],
            rows: r.services.map((s) => [
                s.name,
                s.startTime && s.endTime ? `${formatTimeOfDay(s.startTime)} – ${formatTimeOfDay(s.endTime)}` : "—",
                s.cutoff.hasCutoff ? `${s.cutoff.passed ? "Closed" : "Open till"} ${formatTimeOfDay(s.cutoff.cutoffTime)}` : "No cutoff",
                String(s.confirmed.bookingCount), String(s.confirmed.totalQuantity),
                s.confirmed.byVariant.filter((v) => v.quantity > 0).map((v) => `${v.quantity} ${v.variantName}`).join(", ") || "—",
                s.confirmed.bookingCount ? `${s.served.quantity} / ${s.confirmed.totalQuantity}` : "—",
                ...(r.hasPrices ? [s.amount ? rs(s.amount) : "—"] : []),
            ]),
            foot: ["Total", "", "", String(t.bookings), String(t.confirmedQuantity), "", `${t.served.quantity} / ${t.confirmedQuantity}`, ...(r.hasPrices ? [rs(t.amount)] : [])],
        });

        if (r.byOutlet) {
            pdfHeading(doc, "By outlet");
            pdfTable(doc, {
                columns: [{ label: "Outlet" }, ...r.services.map((s) => ({ label: s.name, width: 58, align: "right" })), { label: "Meals", width: 48, align: "right" }, { label: "Bookings", width: 52, align: "right" }],
                rows: r.byOutlet.map((o) => [`${o.name}${o.active ? "" : " (inactive)"}`, ...o.services.map((s) => String(s.totalQuantity)), String(o.totalQuantity), String(o.bookingCount)]),
            });
        }

        // Per service: option counts + booking list
        for (const s of r.services) {
            if (!s.bookings.length && !s.confirmed.totalQuantity) continue;
            pdfHeading(doc, `${s.name} — ${plural(s.confirmed.totalQuantity, "meal")}`,
                `${plural(s.confirmed.bookingCount, "confirmed booking")} · ${s.served.bookings} collected · ${s.late.bookings} after cutoff · ${s.cancelled.bookings} cancelled`);
            pdfTable(doc, {
                columns: [{ label: "Option" }, { label: "Confirmed quantity", width: 110, align: "right" }, { label: "Collected", width: 80, align: "right" }],
                rows: s.confirmed.byVariant.map((v) => {
                    const served = s.bookings.filter((b) => b.status === "confirmed" && b.consumedAt)
                        .reduce((n, b) => n + (b.lines.find((l) => l.variantName === v.variantName)?.quantity || 0), 0);
                    return [v.variantName, String(v.quantity), String(served)];
                }),
                foot: ["Total", String(s.confirmed.totalQuantity), String(s.served.quantity)],
            });

            if (includeBookingList && s.bookings.length) {
                const live = s.bookings.filter((b) => b.status === "confirmed");
                const other = s.bookings.filter((b) => b.status !== "confirmed");
                if (live.length) {
                    pdfTable(doc, {
                        columns: [
                            { label: "Ref", width: 52 }, { label: "Customer" }, { label: "Mobile", width: 78 },
                            ...(r.hasOutlets ? [{ label: "Outlet", width: 66 }] : []),
                            { label: "Breakdown" }, { label: "Qty", width: 30, align: "right" },
                            { label: "Collected", width: 62 }, { label: "Notes", width: 90 },
                        ],
                        rows: live.map((b) => [
                            b.reference,
                            `${b.customer}${b.organisation ? `\n${b.organisation}` : ""}${b.source === "operator" ? "\n(entered at counter)" : ""}`,
                            prettyPhone(b.phone),
                            ...(r.hasOutlets ? [b.outletName || "—"] : []),
                            b.lines.map((l) => `${l.quantity} ${l.variantName}`).join(", "),
                            String(b.totalQuantity),
                            b.consumedAt ? `Yes · ${formatInstant(b.consumedAt, r.tz, { date: false }).replace(` ${r.zone}`, "")}` : "No",
                            [b.submittedAfterCutoff ? "After cutoff" : "", b.location ? `To: ${b.location}` : "", b.customerNote,
                                ...b.answers.map((a) => `${a.label}: ${a.value}`)].filter(Boolean).join("\n"),
                        ]),
                        fontSize: 7.8,
                    });
                }
                if (other.length) {
                    pdfTable(doc, {
                        columns: [{ label: "Not counted", width: 52 }, { label: "Customer" }, { label: "Mobile", width: 78 }, { label: "Qty", width: 30, align: "right" }, { label: "Status", width: 90 }],
                        rows: other.map((b) => [b.reference, b.customer, prettyPhone(b.phone), String(b.totalQuantity), STATUS_LABEL[b.status] || b.status]),
                        zebra: false, fontSize: 7.8,
                    });
                }
            }
        }

        if (includeTomorrow) {
            const tm = r.tomorrow;
            pdfHeading(doc, `Outlook for ${tm.dateLabel}`, `${plural(tm.confirmedQuantity, "meal")} across ${plural(tm.bookings, "booking")} confirmed so far`);
            pdfTable(doc, {
                columns: [{ label: "Meal service" }, { label: "Bookings", width: 60, align: "right" }, { label: "Meals so far", width: 70, align: "right" }, { label: "Breakdown by option" }],
                rows: tm.services.map((s) => [s.name, String(s.bookingCount), String(s.totalQuantity), s.byVariant.map((v) => `${v.quantity} ${v.variantName}`).join(", ") || "—"]),
            });
        }

        // Footer on every page, with "Page x of y" now that the count is known.
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            const W = doc.page.width, H = doc.page.height;
            // The footer sits inside the bottom margin on purpose; pdfkit
            // would otherwise treat text there as overflow and open a new
            // page for it.
            doc.page.margins.bottom = 0;
            doc.font("Helvetica").fontSize(7.5).fillColor(FAINT);
            doc.text(`${BRAND.productName} — Daily Booking Report — ${r.business.name} — ${r.dateLabel}. Counts include confirmed bookings only.`, M, H - 24, { width: W - M * 2 - 80, lineBreak: false });
            doc.text(`Page ${i - range.start + 1} of ${range.count}`, W - M - 80, H - 24, { width: 80, align: "right", lineBreak: false });
        }
        doc.end();
    });
}

/* ------------------------------------------------------------------ */
/* SEND                                                                 */
/* ------------------------------------------------------------------ */
const pdfFileName = (report) =>
    `daily-report-${report.business.slug || "canteen"}-${report.date}.pdf`.replace(/[^\w.-]+/g, "-");

/**
 * Build, render and send one report. Used by the scheduler and by the
 * dashboard's "Send now". Resolves with what was sent; rejects with the
 * mailer's safe error.
 *
 * @param opts
 *   business    a Business document or lean object (needs _id, dailyReport)
 *   date        "YYYY-MM-DD" in the business zone, default today
 *   recipients  [emails]; defaults to business.dailyReport.recipients
 *   now         injected clock
 *   trigger     "schedule" | "manual" | "test" — for the audit trail
 *   actor       { userId, name } when a person pressed the button
 */
async function sendDailyReport({ business, date, recipients, now = new Date(), trigger = "schedule", actor = null }) {
    const cfg = business.dailyReport || {};
    const to = [...new Set((Array.isArray(recipients) && recipients.length ? recipients : cfg.recipients || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    if (!to.length) throw Object.assign(new Error("No recipients are set for the daily report."), { status: 400, code: "NO_RECIPIENTS" });

    const report = await buildDayReport({ businessId: business._id, date, now });
    const attachPdf = cfg.attachPdf !== false;
    const includeTomorrow = cfg.includeTomorrow !== false;
    const includeBookingList = cfg.includeBookingList !== false;
    const name = pdfFileName(report);

    const mail = renderEmail(report, { attachPdf, includeTomorrow, pdfName: name });
    const attachments = attachPdf ? [{ name, content: await renderPdf(report, { includeBookingList, includeTomorrow }) }] : [];

    await mailer.sendMail({ recipients: to.map((email) => ({ email })), subject: mail.subject, html: mail.html, text: mail.text, attachments });

    record({
        businessId: business._id, actor,
        action: trigger === "schedule" ? "Emailed the daily booking report" : trigger === "test" ? "Sent a test daily report" : "Sent the daily booking report on demand",
        details: { date: report.date, recipients: to.length, meals: report.totals.confirmedQuantity, bookings: report.totals.bookings, pdf: attachPdf },
    });

    return { date: report.date, to, subject: mail.subject, meals: report.totals.confirmedQuantity, bookings: report.totals.bookings, pdf: attachPdf ? name : null };
}

module.exports = { buildDayReport, renderEmail, renderPdf, sendDailyReport, pdfFileName };
