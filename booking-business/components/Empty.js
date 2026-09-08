export default function Empty({ title, note, action }) {
    return (
        <div className="empty">
            <div className="empty-title">{title}</div>
            {note && <p className="small" style={{ maxWidth: 400, margin: "0 auto" }}>{note}</p>}
            {action && <div style={{ marginTop: 14 }}>{action}</div>}
        </div>
    );
}
