// `page`: the only thing on screen, no chrome around it — centres on the
// viewport. `content`: a whole route's .content area while Sidebar/Topbar
// stay mounted. Neither: an inline/section loader.
export default function Spinner({ large = false, label, page = false, content = false }) {
    const cls = page ? "center-fill-page" : content ? "center-fill-content" : "center-fill";
    return (
        <div className={cls} role="status" aria-label={label || "Loading"}>
            <div className={`spinner ${large ? "spinner-lg" : ""}`} />
        </div>
    );
}
