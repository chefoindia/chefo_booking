export function Field({ label, hint, children }) {
    return (
        <div className="field">
            {label && <label>{label}</label>}
            {children}
            {hint && <span className="hint">{hint}</span>}
        </div>
    );
}
export const Input = (p) => <input className="input" {...p} />;
export const Select = ({ children, ...p }) => <select className="select" {...p}>{children}</select>;
export const Textarea = (p) => <textarea className="textarea" {...p} />;
export const Check = ({ label, ...p }) => (
    <label className="check-row"><input type="checkbox" {...p} />{label}</label>
);
