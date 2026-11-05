// Uppercase micro-label for editorial section headers.
export default function Eyebrow({ className = '', children, ...rest }) {
  return <span className={['eyebrow', className].filter(Boolean).join(' ')} {...rest}>{children}</span>;
}
