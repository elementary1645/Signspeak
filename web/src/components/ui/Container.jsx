// Width-constrained wrapper. variant 'inner' (header/footer) or 'page' (page content).
export default function Container({ variant = 'inner', as: Tag = 'div', className = '', children, ...rest }) {
  return <Tag className={[variant, className].filter(Boolean).join(' ')} {...rest}>{children}</Tag>;
}
