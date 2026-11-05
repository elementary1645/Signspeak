import { useEffect, useRef } from 'react';

// Minimal accessible modal: Escape + click-backdrop to close, focuses first control,
// locks page scroll while open. Primitive for later stages (e.g. sign detail).
export default function Modal({ open, onClose, title, className = '', children, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const el = ref.current;
    const focusable = el && el.querySelector('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable) focusable.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} {...rest}>
      <div className={['modal', className].filter(Boolean).join(' ')} ref={ref} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        {title && <h2 className="modal-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
