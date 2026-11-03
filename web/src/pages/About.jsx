import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api.js';
import { EVENT, TEAM } from '../content.js';

const pct = v => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '–');
const f2 = v => (typeof v === 'number' ? v.toFixed(2) : '–');
const SCHEME = {
  'leave-one-signer-out': 'Leave-one-signer-out: each signer was tested on a model that never saw them',
  'grouped-by-session': 'Grouped by session: new sessions of the same people, not new people',
  'grouped-by-take': 'Grouped by take: new recordings of the same people, not new people',
};

function ModelPanel({ model }) {
  if (!model) return <p className="muted">Loading…</p>;
  if (!model.trained) return <p className="notice">No model trained yet. No accuracy numbers exist, so none are shown.</p>;
  const rows = Object.entries(model.per_class || {});
  return (
    <>
      {!model.loaded && <p className="notice warn small">This report is from the last training run, but the server has not loaded that model{model.load_detail ? `: ${model.load_detail}` : ''}.</p>}
      {model.evaluation.warning && <p className="notice warn small">{model.evaluation.warning}</p>}
      <dl className="facts">
        <dt>Model</dt><dd>{model.model_type}</dd>
        <dt>Trained</dt><dd>{model.trained_at}</dd>
        <dt>Training data</dt><dd>{model.counts.signers} signers · {model.counts.sessions} sessions · {model.counts.takes} takes · {model.counts.windows} windows</dd>
        <dt>Evaluation</dt><dd>{SCHEME[model.evaluation.scheme] || model.evaluation.scheme}</dd>
        <dt>Macro-F1 with rejection</dt><dd>{f2(model.macro_f1_open_set)}</dd>
        <dt>Macro-F1 without rejection</dt><dd>{f2(model.macro_f1_closed_set)}</dd>
        <dt>NONE wrongly shown as a sign</dt><dd>{pct(model.none_false_accept_rate)}</dd>
        <dt>Signs rejected as unknown</dt><dd>{pct(model.sign_rejection_rate)}</dd>
        {model.latency && <><dt>Live cost per window</dt><dd>{model.latency.ms_per_window[model.model_type]?.toFixed(1)} ms on the training machine (limit {model.latency.max_latency_ms} ms)</dd></>}
        <dt>Vocabulary version</dt><dd><code>{model.vocabulary_version}</code></dd>
        <dt>Thresholds</dt><dd>confidence ≥ {model.thresholds.min_confidence}, margin ≥ {model.thresholds.min_margin}</dd>
      </dl>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Per-class results with rejection</caption>
          <thead><tr><th scope="col">Label</th><th scope="col" className="num">Precision</th><th scope="col" className="num">Recall</th><th scope="col" className="num">F1</th><th scope="col" className="num">Windows</th></tr></thead>
          <tbody>
            {rows.map(([label, m]) => (
              <tr key={label}><th scope="row">{label}</th><td className="num">{f2(m.precision)}</td><td className="num">{f2(m.recall)}</td><td className="num">{f2(m['f1-score'])}</td><td className="num">{m.support}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">All numbers come from the training run’s metrics.json. Each window is 1.6 seconds of movement. Thresholds were tuned on validation folds only.</p>
    </>
  );
}

export default function About() {
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { getJSON('/api/model').then(setModel).catch(err => setError(err.message)); }, []);
  return (
    <div className="page">
      <h1>About SignSpeak</h1>
      <div className="grid-2">
        <section className="card">
          <h2>Why</h2>
          <p>Millions of Deaf people in India use Indian Sign Language, but few hearing people know it, and certified interpreters are scarce.
            SignSpeak is a small step towards everyday conversations, such as at a counter, a clinic reception or a classroom, where a few
            common signs shown as text and speech in a local language help.</p>
          <p>We started with a handful of signs and did them carefully. Each one is checked against the official ISLRTC dictionary,
            recorded with consent and tested on people the model has not seen.</p>
        </section>
        <section className="card">
          <h2>Limits</h2>
          <ul>
            <li>Small vocabulary. It recognises single, isolated signs, not sentences or ISL grammar.</li>
            <li>No facial expressions, so signs that depend on them are excluded.</li>
            <li>Lighting, camera angle and signing style affect it. It can still mistake an unfamiliar movement for a sign.</li>
            <li>Kannada, Hindi and Tamil wording is awaiting a native-speaker check.</li>
            <li>Not for medical, legal or emergency communication. It does not replace an interpreter.</li>
          </ul>
        </section>
      </div>

      <section className="card" aria-labelledby="model-heading">
        <h2 id="model-heading">The model</h2>
        {error ? <p className="notice error">Could not load the model report: {error}</p> : <ModelPanel model={model} />}
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Privacy</h2>
          <p>Your video never leaves your device. Only hand and body landmark points are sent for recognition. They are processed in memory and
            not stored. Recordings used for training were made by consenting volunteers under pseudonyms.</p>
        </section>
        <section className="card">
          <h2>Team</h2>
          <p className="muted">{EVENT}</p>
          <ul>{TEAM.map(t => <li key={t.name}><a href={t.url} target="_blank" rel="noreferrer">{t.name}</a>, {t.role}</li>)}</ul>
          <p className="muted small">Built with Google MediaPipe, FastAPI and scikit-learn. Sign references: ISLRTC. AI assistants (ChatGPT/Codex,
            Claude Code) helped write the code and documentation; people verified the signs and recorded the data.</p>
        </section>
      </div>
    </div>
  );
}
