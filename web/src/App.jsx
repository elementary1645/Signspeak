import { useEffect, useState } from 'react';
import Translate from './pages/Translate.jsx';
import Collect from './pages/Collect.jsx';

const PAGES = { '/translate': Translate, '/collect': Collect };

// Two pages do not justify a router dependency.
export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = to => event => {
    event.preventDefault();
    window.history.pushState(null, '', to);
    setPath(to);
  };
  const Page = PAGES[path] || Translate;
  return (
    <>
      <nav>
        <strong>SignSpeak</strong>
        <a href="/translate" onClick={go('/translate')} aria-current={Page === Translate ? 'page' : undefined}>Translate</a>
        <a href="/collect" onClick={go('/collect')} aria-current={Page === Collect ? 'page' : undefined}>Collect</a>
      </nav>
      <main><Page key={path} /></main>
    </>
  );
}
