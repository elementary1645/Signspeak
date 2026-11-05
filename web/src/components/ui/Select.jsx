// Thin styled <select>; global select styles apply. Passes through all native props.
export default function Select({ className = '', children, ...rest }) {
  return <select className={className} {...rest}>{children}</select>;
}
