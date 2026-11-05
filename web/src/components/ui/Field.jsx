// Labelled form field wrapper (the .field pattern used across the app).
export default function Field({ label, className = '', children, ...rest }) {
  return (
    <label className={['field', className].filter(Boolean).join(' ')} {...rest}>
      {label != null && label !== false ? <span>{label}</span> : null}
      {children}
    </label>
  );
}
