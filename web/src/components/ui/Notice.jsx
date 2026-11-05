// Alert/banner. variant: 'ok' | 'warn' | 'error' (none = neutral).
export default function Notice({ variant, title, role, className = '', children, ...rest }) {
  const cls = ['notice', variant, className].filter(Boolean).join(' ');
  return (
    <div className={cls} role={role} {...rest}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}
