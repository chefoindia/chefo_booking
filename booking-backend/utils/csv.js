// utils/csv.js — one CSV writer, so every export escapes the same way.
//
// RFC 4180: a field containing a comma, quote or newline is wrapped in quotes
// and inner quotes are doubled. A leading =, +, - or @ is prefixed with an
// apostrophe so a cell like "=HYPERLINK(...)" typed into a customer note can
// never execute when the file is opened in Excel — spreadsheet formula
// injection is a real attack on exactly this kind of export.
function cell(v) {
    if (v === null || v === undefined) return "";
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows: array of arrays. Returns the file body with a BOM so Excel reads UTF-8. */
function toCsv(rows) {
    return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Sets the headers and sends. `name` without extension. */
function sendCsv(res, name, rows) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\w.-]+/g, "-")}.csv"`);
    res.send(toCsv(rows));
}

module.exports = { toCsv, sendCsv, cell };
