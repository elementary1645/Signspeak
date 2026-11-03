import { useCallback, useEffect, useRef, useState } from 'react';
import Home from './pages/Home.jsx';
import Translate from './pages/Translate.jsx';
import Learn from './pages/Learn.jsx';
import HowItWorks from './pages/HowItWorks.jsx';
import About from './pages/About.jsx';
import Collect from './pages/Collect.jsx';
import { BrandMark } from './lib/icons.jsx';
import { nextTheme, readTheme, applyTheme, THEME_LABEL } from './lib/theme.js';

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
  return [...PAGES, ...HIDDEN].find(p => p.path === clean) || PAGES[0];
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [theme, setTheme] = useState(readTheme);
  const mainRef = useRef(null);
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
  }, [page]);

  const navigate = useCallback(to => {
    window.history.pushState(null, '', to);
    setPath(to);
  }, []);
  const link = to => event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  const Page = page.component;

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="inner">
          <a className="brand" href="/" onClick={link('/')}><BrandMark className="brand-mark" /> SignSpeak</a>
          <nav className="nav" aria-label="Main">
            {PAGES.map(p => (
              <a key={p.path} href={p.path} onClick={link(p.path)} aria-current={p === page ? 'page' : undefined}>{p.title}</a>
            ))}
          </nav>
          <button className="btn theme-toggle" onClick={() => setTheme(nextTheme(theme))} aria-label={`Colour theme: ${THEME_LABEL[theme]}. Change theme`}>
            {THEME_LABEL[theme]}
          </button>
        </div>
      </header>
      <main id="main" ref={mainRef}><Page navigate={navigate} link={link} key={page.path} /></main>
      <footer className="site-footer">
        <div className="inner">
          <span>SignSpeak · Human Impact hackathon, November 2026</span>
          <span>Your video never leaves your device.</span>
          <a href="/collect" onClick={link('/collect')}>Contribute sign recordings</a>
        </div>
      </footer>
    </>
  );
}
