// Editorial section. Vertical rhythm comes from .section + .section spacing.
export default function Section({ as: Tag = 'section', className = '', children, ...rest }) {
  return <Tag className={['section', className].filter(Boolean).join(' ')} {...rest}>{children}</Tag>;
}
