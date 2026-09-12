"use client";
// components/Pagination.js — "Showing 51–100 of 312", previous/next, and a
// page-size picker. One component so every list pages the same way.
export default function Pagination({ page, perPage, total, onPage, onPerPage, sizes = [25, 50, 100] }) {
    const pages = Math.max(1, Math.ceil((total || 0) / (perPage || 1)));
    const from = total ? (page - 1) * perPage + 1 : 0;
    const to = Math.min(page * perPage, total || 0);
    return (
        <div className="pager">
            <span className="small muted">
                {total ? <>Showing <strong>{from}–{to}</strong> of <strong>{total}</strong></> : "Nothing to show"}
            </span>
            <div className="row" style={{ gap: 6 }}>
                {onPerPage && (
                    <select className="select" style={{ width: "auto", padding: "5px 8px", fontSize: 12.5 }} value={perPage}
                        onChange={(e) => onPerPage(Number(e.target.value))} aria-label="Rows per page">
                        {sizes.map((s) => <option key={s} value={s}>{s} / page</option>)}
                    </select>
                )}
                <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
                <span className="small muted" style={{ minWidth: 70, textAlign: "center" }}>Page {page} of {pages}</span>
                <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
            </div>
        </div>
    );
}
