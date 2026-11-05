// Simple line icons (inline SVG, currentColor). Decorative unless given a title.
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' };

export function BrandMark(props) {
  return (
    <svg viewBox="0 0 32 32" {...props} aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
      <path d="M9 22V12.5a1.5 1.5 0 0 1 3 0V17m0-6.5a1.5 1.5 0 0 1 3 0V17m0-5.5a1.5 1.5 0 0 1 3 0V17m0-3.5a1.5 1.5 0 0 1 3 0V20a5 5 0 0 1-5 5h-1.5a6 6 0 0 1-4.5-2"
        fill="none" stroke="var(--accent-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const ShieldIcon = props => (
  <svg viewBox="0 0 24 24" {...base} {...props}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const HandIcon = props => (
  <svg viewBox="0 0 24 24" {...base} {...props}><path d="M7 13V6.5a1.5 1.5 0 0 1 3 0V12m0-7a1.5 1.5 0 0 1 3 0v7m0-6a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.5 15a1.6 1.6 0 0 1 2.5-2" /></svg>
);
export const SpeakerIcon = props => (
  <svg viewBox="0 0 24 24" {...base} {...props}><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
);
export const LanguageIcon = props => (
  <svg viewBox="0 0 24 24" {...base} {...props}><path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 6 5.5 7.5M11 5c-.8 3.5-3 6.5-6 8" /><path d="M13 21l4-9 4 9M14.5 18h5" /></svg>
);
export const InfoIcon = props => (
  <svg viewBox="0 0 24 24" {...base} {...props}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
);
export const ReplayIcon = props => (
  <svg viewBox="0 0 24 24" {...base} {...props}><path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.5" /><path d="M4 4v4.5h4.5" /></svg>
);

export const MenuIcon = props => (
  <svg viewBox="0 0 24 24" {...base} {...props}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const CloseIcon = props => (
  <svg viewBox="0 0 24 24" {...base} {...props}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
