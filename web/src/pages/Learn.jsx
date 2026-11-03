import { useEffect, useState } from 'react';
import { LANGUAGES, getJSON } from '../lib/api.js';
import { embedUrl } from '../lib/embed.js';

const yesNo = v => (v === true ? 'Yes' : v === false ? 'No' : 'Not recorded');

function SignCard({ sign }) {
  const embed = embedUrl(sign.reference_url);
  return (
    <article className="card sign-card" aria-labelledby={`sign-${sign.label}`}>
      <h3 id={`sign-${sign.label}`}>
        <span>{sign.translations?.en || sign.label}</span>
        <span className="sign-label">{sign.label}</span>
      </h3>
      {sign.recognised_by_model
        ? <p className="notice ok small">Recognised by the live model</p>
        : <p className="notice small">Verified. Not in the live model yet.</p>}
      {sign.translations && (
        <ul className="translations" aria-label="Meaning in each language">
          {LANGUAGES.map(l => (
            <li key={l.code} lang={l.bcp47}><span className="lang">{l.english || l.name}</span>{sign.translations[l.code]}</li>
          ))}
        </ul>
      )}
      <dl className="facts">
        <dt>Hands</dt><dd>{sign.hand_count === 2 ? 'Two hands' : sign.hand_count === 1 ? 'One hand' : 'Not recorded'}</dd>
        <dt>Movement</dt><dd>{yesNo(sign.motion_required)}</dd>
        <dt>Hands relative to each other</dt><dd>{yesNo(sign.relative_hand_position_required)}</dd>
        <dt>Body location</dt><dd>{yesNo(sign.body_cues_required)}</dd>
      </dl>
      {sign.notes && <p><strong>How to sign it:</strong> {sign.notes}</p>}
      {embed && (
        <div className="embed">
          <iframe src={embed} title={`Official ISLRTC video for ${sign.label}`} loading="lazy"
            allow="encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
        </div>
      )}
      <p><a href={sign.reference_url} target="_blank" rel="noreferrer">Official ISLRTC reference{sign.reference_id && sign.reference_id !== sign.reference_url ? `: ${sign.reference_id}` : ''}</a>
        {sign.reviewed_on && <span className="muted small"> · checked {sign.reviewed_on}</span>}</p>
    </article>
  );
}

export default function Learn() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { getJSON('/api/signs').then(setData).catch(err => setError(err.message)); }, []);

  return (
    <div className="page">
      <h1>Learn ISL</h1>
      <p className="lede">These are the signs SignSpeak supports. Each one was checked by a person against the official
        Indian Sign Language Research and Training Centre (ISLRTC) dictionary. Learn from the official video; the notes are a
        reviewer’s summary.</p>
      {error && <p className="notice error" role="alert">Could not load the sign list: {error}</p>}
      {data && (
        <>
          <h2>Supported signs ({data.verified.length})</h2>
          {data.verified.length
            ? <div className="grid-2">{data.verified.map(s => <SignCard key={s.label} sign={s} />)}</div>
            : <p className="notice">No sign has been verified yet. Signs appear here once a reviewer has checked them against the official dictionary.</p>}

          <section className="card" aria-labelledby="pending-heading" style={{ marginTop: 28 }}>
            <h2 id="pending-heading">Not supported yet</h2>
            <p className="muted">Candidates the team is preparing. They have <strong>not</strong> been verified, and SignSpeak does not
              recognise them. Don’t learn them from this list.</p>
            <ul className="pending-list">
              {data.not_supported_yet.map(s => <li key={s.label}>{s.label}{s.has_reference ? ' (official link found, review pending)' : ''}</li>)}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
