// Loading placeholder. Decorative (aria-hidden); shimmer respects reduced-motion.
export default function Skeleton({ className = '', style, ...rest }) {
  return <span className={['skeleton', className].filter(Boolean).join(' ')} style={style} aria-hidden="true" {...rest} />;
}
