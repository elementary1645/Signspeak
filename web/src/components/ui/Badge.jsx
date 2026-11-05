// Status pill backed by the .badge token styles. data-state drives the dot colour,
// data-variant is an optional secondary state (e.g. warn).
export default function Badge({ state, variant, className = '', children, ...rest }) {
  const cls = ['badge', className].filter(Boolean).join(' ');
  const props = { className: cls };
  if (state) props['data-state'] = state;
  if (variant) props['data-variant'] = variant;
  return <span {...props} {...rest}>{children}</span>;
}
