import { useCallback, useEffect, useRef, useState } from 'react';
import Home from './pages/Home.jsx';
import Translate from './pages/Translate.jsx';
import Learn from './pages/Learn.jsx';
import HowItWorks from './pages/HowItWorks.jsx';
import About from './pages/About.jsx';
import Collect from './pages/Collect.jsx';
import { BrandMark, MenuIcon, CloseIcon } from './lib/icons.jsx';
import { nextTheme, readTheme, applyTheme, THEME_LABEL } from './lib/theme.js';
import { Button, Container } from './components/ui';

export const PAGES = [
  { path: '/', title: 'Home', component: Home },
  { path: '/translate', title: 'Translate', component: Translate },
  { path: '/learn', title: 'Learn ISL', component: Learn },
  { path: '/how-it-works', title: 'How It Works', component: HowItWorks },
  { path: '/about', title: 'About & Model', component: About },
];
const HIDDEN = [{ path: '/collect', title: 'Collect', component: Collect }];

export function findPage(path) {
  const clean = path.replace(/\/+$/, '') || '/';
  // Allow /learn/:label detail slugs — still rendered by the Learn component.
  if (clean.startsWith('/learn/')) return PAGES.find(p => p.path === '/learn');
  return [...PAGES, ...HIDDEN].find(p => p.path === clean) || PAGES[0];
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [theme, setTheme] = useState(readTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef(null);
  const headerRef = useRef(null);
  const navRef = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);

  const page = findPage(path);
  useEffect(() => {
    document.title = page.path === '/' ? 'SignSpeak · Indian Sign Language to text and speech' : `${page.title} · SignSpeak`;
    if (first.current) { first.current = false; return; }
    // Move focus to the new page heading so keyboard and screen-reader users land on it.
    const heading = mainRef.current?.querySelector('h1');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
    window.scrollTo(0, 0);
    setMenuOpen(false);
  }, [page]);

  // Close the mobile menu on Escape, on a click outside the header, and on route change.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = e => { if (e.key === 'Escape') setMenuOpen(false); };
    const onDown = e => { if (headerRef.current && !headerRef.current.contains(e.target)) setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [menuOpen]);

  const navigate = useCallback(to => {
    window.history.pushState(null, '', to);
    setPath(to);
  }, []);
  const link = to => event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  const navLink = to => event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
    setMenuOpen(false);
  };
  const openMenu = () => { setMenuOpen(true); requestAnimationFrame(() => navRef.current?.querySelector('a')?.focus()); };
  const Page = page.component;

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header" ref={headerRef}>
        <Container>
          <a className="brand" href="/" onClick={navLink('/')} aria-label="SignSpeak — home">
            <BrandMark className="brand-mark" />
            <span className="brand-wordmark">SignSpeak</span>
          </a>
          <Button variant="ghost" size="sm" className="menu-toggle" aria-expanded={menuOpen} aria-controls="primary-nav"
            onClick={menuOpen ? () => setMenuOpen(false) : openMenu} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>
            {menuOpen ? <CloseIcon className="icon" style={{ width: 20, height: 20 }} /> : <MenuIcon className="icon" style={{ width: 20, height: 20 }} />}
            <span>{menuOpen ? 'Close' : 'Menu'}</span>
          </Button>
          <nav id="primary-nav" ref={navRef} className={`nav${menuOpen ? ' open' : ''}`} aria-label="Main">
            {PAGES.map(p => (
              <a key={p.path} href={p.path} onClick={navLink(p.path)} aria-current={p === page ? 'page' : undefined}>{p.title}</a>
            ))}
          </nav>
          <Button variant="ghost" size="sm" className="theme-toggle" onClick={() => setTheme(nextTheme(theme))}
            aria-label={`Colour theme: ${THEME_LABEL[theme]}. Change theme`}>
            {THEME_LABEL[theme]}
          </Button>
        </Container>
      </header>
      <main id="main" ref={mainRef}><Page navigate={navigate} link={link} key={page.path} /></main>
      <footer className="site-footer">
        <Container>
          <a className="brand brand-sm" href="/" onClick={link('/')} aria-label="SignSpeak — home">
            <BrandMark className="brand-mark" /> <span className="brand-wordmark">SignSpeak</span>
          </a>
          <nav className="footer-links" aria-label="Footer">
            {PAGES.map(p => <a key={p.path} href={p.path} onClick={link(p.path)}>{p.title}</a>)}
            <a href="/collect" onClick={link('/collect')}>Contribute</a>
          </nav>
          <span className="footer-meta">Human Impact hackathon · November 2026</span>
          <span className="footer-meta">Your video never leaves your device.</span>
        </Container>
      </footer>
    </>
  );
}
