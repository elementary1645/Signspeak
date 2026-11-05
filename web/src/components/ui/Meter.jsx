// Confidence bar (role="meter") backed by .meter token styles. value is 0..1.
export default function Meter({ value = 0, labelId, className = '', ...rest }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const props = { className: ['meter', className].filter(Boolean).join(' '), role: 'meter',
    'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct };
  if (labelId) props['aria-labelledby'] = labelId;
  return <div {...props} {...rest}><span style={{ width: `${pct}%` }} /></div>;
}
