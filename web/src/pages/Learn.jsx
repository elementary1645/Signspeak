import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGES, getJSON } from '../lib/api.js';
import { embedUrl } from '../lib/embed.js';

// ── Helpers ───────────────────────────────────────────────────────────────
const yesNo = v => (v === true ? 'Yes' : v === false ? 'No' : '–');

function slugOf(label) { return label.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function labelOfSlug(slug, signs) { return signs.find(s => slugOf(s.label) === slug); }

// Read the optional /learn/:slug detail route from the URL.
function readSlug() {
  const m = window.location.pathname.match(/^\/learn\/(.+)$/);
  return m ? m[1] : null;
}

// ── Library card ──────────────────────────────────────────────────────────
function SignCard({ sign, onSelect }) {
  const handleClick = e => { e.preventDefault(); onSelect(sign); };
  return (
    <article className="lrn-card">
      <div className="lrn-card-body">
        <div className="lrn-card-header">
          <span className="lrn-card-en">{sign.translations?.en || sign.label}</span>
          <span className="sign-label">{sign.label}</span>
        </div>
        {sign.translations && (
          <ul className="lrn-card-langs" aria-label="Translations">
            {LANGUAGES.filter(l => l.code !== 'en').map(l => (
              <li key={l.code} lang={l.bcp47}>
                <span className="lrn-lang-label">{l.english || l.name}</span>
                <span>{sign.translations[l.code]}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="lrn-card-meta">
          {sign.hand_count != null && (
            <span className="lrn-chip">{sign.hand_count === 1 ? '1 hand' : '2 hands'}</span>
          )}
          {sign.motion_required === true && <span className="lrn-chip">Motion</span>}
          {sign.body_cues_required === true && <span className="lrn-chip">Body location</span>}
          {sign.recognised_by_model
            ? <span className="lrn-chip lrn-chip-live">Live model</span>
            : <span className="lrn-chip lrn-chip-verified">Verified</span>}
        </div>
      </div>
      <a className="lrn-card-action" href={`/learn/${slugOf(sign.label)}`} onClick={handleClick}
        aria-label={`View details for ${sign.translations?.en || sign.label}`}>
        Learn this sign →
      </a>
    </article>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────
function SignDetail({ sign, onBack }) {
  const embed = embedUrl(sign.reference_url);
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  return (
    <div className="lrn-detail">
      <button className="lrn-back btn ghost sm" onClick={onBack}>← Back to sign library</button>
      <div className="lrn-detail-inner">
        {/* Header */}
        <header className="lrn-detail-header">
          <div>
            <h1 className="lrn-detail-en" ref={headingRef} tabIndex={-1}>
              {sign.translations?.en || sign.label}
            </h1>
            <p className="sign-label">{sign.label}</p>
          </div>
          <div className="lrn-detail-chips">
            {sign.recognised_by_model
              ? <span className="lrn-chip lrn-chip-live">Recognised by the live model</span>
              : <span className="lrn-chip lrn-chip-verified">Verified · not in the live model yet</span>}
          </div>
        </header>

        <div className="lrn-detail-body">
          {/* Video + reference */}
          <div className="lrn-detail-media">
            {embed ? (
              <div className="embed">
                <iframe src={embed} title={`Official ISLRTC video for ${sign.label}`} loading="lazy"
                  allow="encrypted-media; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
              </div>
            ) : (
              <div className="lrn-no-embed">
                <p className="muted">No embeddable video available.</p>
              </div>
            )}
            <p className="lrn-ref-link">
              <a href={sign.reference_url} target="_blank" rel="noreferrer">
                Official ISLRTC reference
                {sign.reference_id && sign.reference_id !== sign.reference_url ? `: ${sign.reference_id}` : ''}
              </a>
              {sign.reviewed_on && <span className="muted"> · checked {sign.reviewed_on}</span>}
            </p>
          </div>

          {/* Facts + translations */}
          <div className="lrn-detail-info">
            {sign.notes && (
              <div className="lrn-notes">
                <p className="eyebrow" style={{ marginBottom: 6 }}>How to sign it</p>
                <p>{sign.notes}</p>
              </div>
            )}

            <div>
              <p className="eyebrow" style={{ marginBottom: 8 }}>Sign properties</p>
              <dl className="facts">
                <dt>Hands</dt><dd>{sign.hand_count === 2 ? 'Two hands' : sign.hand_count === 1 ? 'One hand' : '–'}</dd>
                <dt>Movement</dt><dd>{yesNo(sign.motion_required)}</dd>
                <dt>Hands relative to each other</dt><dd>{yesNo(sign.relative_hand_position_required)}</dd>
                <dt>Body location</dt><dd>{yesNo(sign.body_cues_required)}</dd>
              </dl>
            </div>

            {sign.translations && (
              <div>
                <p className="eyebrow" style={{ marginBottom: 8 }}>Meaning in each language</p>
                <ul className="translations" aria-label="Meaning in each language">
                  {LANGUAGES.map(l => (
                    <li key={l.code} lang={l.bcp47}>
                      <span className="lang">{l.english || l.name}</span>
                      {sign.translations[l.code]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function Learn({ navigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'live' | '1hand' | '2hand' | 'motion'
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    getJSON('/api/signs').then(d => {
      setData(d);
      // If we landed on /learn/:slug directly, open that detail immediately.
      const slug = readSlug();
      if (slug && d?.verified) {
        const found = labelOfSlug(slug, d.verified);
        if (found) setDetail(found);
      }
    }).catch(err => setError(err.message));
  }, []);

  function openDetail(sign) {
    setDetail(sign);
    window.history.pushState(null, '', `/learn/${slugOf(sign.label)}`);
    window.scrollTo(0, 0);
  }

  function goBack() {
    setDetail(null);
    window.history.pushState(null, '', '/learn');
    window.scrollTo(0, 0);
  }

  // Handle browser back/forward within /learn.
  useEffect(() => {
    const onPop = () => {
      const slug = readSlug();
      if (slug && data?.verified) {
        const found = labelOfSlug(slug, data.verified);
        setDetail(found || null);
      } else {
        setDetail(null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.verified) return [];
    let list = data.verified;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(s =>
        s.label.toLowerCase().includes(q) ||
        Object.values(s.translations || {}).some(v => typeof v === 'string' && v.toLowerCase().includes(q))
      );
    }
    if (filter === 'live') list = list.filter(s => s.recognised_by_model);
    else if (filter === '1hand') list = list.filter(s => s.hand_count === 1);
    else if (filter === '2hand') list = list.filter(s => s.hand_count === 2);
    else if (filter === 'motion') list = list.filter(s => s.motion_required === true);
    return list;
  }, [data, search, filter]);

  // ── Detail view ──────────────────────────────────────────────────────────
  if (detail) return <SignDetail sign={detail} onBack={goBack} />;

  // ── Library view ─────────────────────────────────────────────────────────
  return (
    <div className="page">
      <h1>Learn ISL</h1>
      <p className="lede">
        Every sign here was verified by a person against the official ISLRTC dictionary.
        Learn from the official video — the notes are a reviewer's summary.
      </p>

      {error && <p className="notice error" role="alert">Could not load the sign list: {error}</p>}

      {data && (
        <>
          {/* Search + filters */}
          <div className="lrn-toolbar">
            <label className="lrn-search-wrap">
              <span className="sr-only">Search signs</span>
              <input className="lrn-search" type="search" placeholder="Search signs…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </label>
            <div className="lrn-filters" role="group" aria-label="Filter signs">
              {[
                { id: 'all', label: 'All' },
                { id: 'live', label: 'In live model' },
                { id: '1hand', label: '1 hand' },
                { id: '2hand', label: '2 hands' },
                { id: 'motion', label: 'With motion' },
              ].map(f => (
                <button key={f.id} className={`lrn-filter-btn${filter === f.id ? ' active' : ''}`}
                  onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          {filtered.length > 0 ? (
            <div className="lrn-grid">
              {filtered.map(s => <SignCard key={s.label} sign={s} onSelect={openDetail} />)}
            </div>
          ) : (
            <p className="muted">No signs match your search or filter.</p>
          )}

          {/* Not-supported section */}
          {data.not_supported_yet.length > 0 && (
            <section className="lrn-pending" aria-labelledby="pending-heading">
              <h2 id="pending-heading">Not supported yet</h2>
              <p className="muted">
                Candidates the team is preparing. They have <strong>not</strong> been verified,
                and SignSpeak does not recognise them. Don't learn them from this list.
              </p>
              <ul className="pending-list">
                {data.not_supported_yet.map(s => (
                  <li key={s.label}>{s.label}{s.has_reference ? ' (official link found, review pending)' : ''}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
