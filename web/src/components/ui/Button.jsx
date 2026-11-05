// Reusable button. Renders an anchor when `href` is given, otherwise a <button>.
// `variant`/`size` map to the Stage-1 .btn classes so existing styles keep working.
export default function Button({ variant, size, href, className = '', type, children, ...rest }) {
  const cls = ['btn', variant, size, className].filter(Boolean).join(' ');
  if (href) return <a className={cls} href={href} {...rest}>{children}</a>;
  return <button className={cls} type={type || 'button'} {...rest}>{children}</button>;
}
