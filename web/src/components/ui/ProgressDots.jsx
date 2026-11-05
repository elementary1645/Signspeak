// Recording/progress dots: filled up to `value`, hollow up to `target`, hidden beyond.
export default function ProgressDots({ value = 0, target = 0, max = 0, className = '', ...rest }) {
  return (
    <span className={['progress', className].filter(Boolean).join(' ')} aria-label={`${value} of ${target}`} {...rest}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? 'dot on' : i < target ? 'dot' : 'dot none'} />
      ))}
    </span>
  );
}
