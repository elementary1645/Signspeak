import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api.js';
import { CROSS_PERSON_CHECK, EVENT, PROJECT, TEAM, TEAM_NAME } from '../content.js';
import { Eyebrow } from '../components/ui';

// ── Helpers (unchanged from original) ────────────────────────────────────
const pct = v => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '–');
const f2  = v => (typeof v === 'number' ? v.toFixed(2) : '–');
const SCHEME = {
  'leave-one-signer-out': 'Leave-one-signer-out: each signer was tested on a model that never saw them',
  'grouped-by-session':   'Grouped by session: new sessions of the same people, not new people',
  'grouped-by-take':      'Grouped by take: new recordings of the same people, not new people',
};

function ModelPanel({ model }) {
  if (!model) return <p className="muted">Loading model report…</p>;
  if (!model.trained) return (
    <div className="notice">No model trained yet. No accuracy numbers exist, so none are shown.</div>
  );
  const rows = Object.entries(model.per_class || {});
  return (
    <div className="abt-model">
      {!model.loaded && (
        <div className="notice warn small">
          This report is from the last training run, but the server has not loaded that model
          {model.load_detail ? `: ${model.load_detail}` : ''}.
        </div>
      )}
      {model.evaluation.warning && (
        <div className="notice warn small">{model.evaluation.warning}</div>
      )}

      <dl className="facts abt-facts">
        <dt>Algorithm</dt><dd>{model.model_type}</dd>
        <dt>Trained at</dt><dd>{model.trained_at}</dd>
        <dt>Training data</dt><dd>{model.counts.signers} signers · {model.counts.sessions} sessions · {model.counts.takes} takes · {model.counts.windows} windows</dd>
        <dt>Evaluation scheme</dt><dd>{SCHEME[model.evaluation.scheme] || model.evaluation.scheme}</dd>
        <dt>Macro-F1 (with rejection)</dt><dd>{f2(model.macro_f1_open_set)}</dd>
        <dt>Macro-F1 (without rejection)</dt><dd>{f2(model.macro_f1_closed_set)}</dd>
        <dt>NONE wrongly shown as a sign</dt><dd>{pct(model.none_false_accept_rate)}</dd>
        <dt>Signs rejected as unknown</dt><dd>{pct(model.sign_rejection_rate)}</dd>
        {model.latency && (
          <><dt>Live cost per window</dt><dd>{model.latency.ms_per_window[model.model_type]?.toFixed(1)} ms on the training machine (limit {model.latency.max_latency_ms} ms)</dd></>
        )}
        <dt>Vocabulary version</dt><dd><code>{model.vocabulary_version}</code></dd>
        <dt>Rejection thresholds</dt><dd>confidence ≥ {model.thresholds.min_confidence}, margin ≥ {model.thresholds.min_margin}</dd>
      </dl>

      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Per-class results with rejection</caption>
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col" className="num">Precision</th>
              <th scope="col" className="num">Recall</th>
              <th scope="col" className="num">F1</th>
              <th scope="col" className="num">Windows</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, m]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td className="num">{f2(m.precision)}</td>
                <td className="num">{f2(m.recall)}</td>
                <td className="num">{f2(m['f1-score'])}</td>
                <td className="num">{m.support}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted small">
        Numbers come from the training run's metrics.json.
        {model.window_frames && model.fps
          ? ` Each window is ${model.window_frames} frames at ${model.fps} FPS (about ${(model.window_frames / model.fps).toFixed(1)} s).`
          : ''}
        {model.threshold_source?.tuned_on === 'leave-one-signer-out'
          ? ' Rejection thresholds were tuned on cross-person predictions and scored on the same predictions — no independent test remains.'
          : ' Rejection thresholds were tuned on validation folds.'}
      </p>

      <CrossPerson model={model} />
    </div>
  );
}

function CrossPerson({ model }) {
  const check = CROSS_PERSON_CHECK;
  const pooled = model.threshold_source?.loso;
  if (model.trained_at !== check.trained_at) {
    return (
      <div className="notice small" style={{ marginTop: 12 }}>
        The cross-person check in the model card was run for an earlier model, so it is not shown here.
      </div>
    );
  }
  return (
    <div className="abt-cross">
      <Eyebrow>Tested on the other person</Eyebrow>
      <p>
        With only 2 signers, the fairest test we have is to train on one person and test on the other.
        The algorithm and thresholds were chosen without the tested person.
        Two people are not enough to measure accuracy for new signers in general.
      </p>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Leave-one-signer-out check, run {check.run}</caption>
          <thead>
            <tr>
              <th scope="col">Fold</th>
              <th scope="col" className="num">Macro-F1</th>
              <th scope="col" className="num">Signs recognised</th>
              <th scope="col" className="num">Non-signs shown as sign</th>
            </tr>
          </thead>
          <tbody>
            {check.folds.map(f => (
              <tr key={f.name}>
                <th scope="row">{f.name}</th>
                <td className="num">{f.macroF1}</td>
                <td className="num">{f.signs}</td>
                <td className="num">{f.noneAccepted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        The main failure for a new person is a non-sign being accepted as HELLO.
        {pooled
          ? ` With the deployed thresholds on the same split: ${pooled.pooled.none_false_accept[0]} of ${pooled.pooled.none_false_accept[1]} non-signs were shown as a sign (pooled macro-F1 ${pooled.pooled.macro_f1.toFixed(3)}), but those thresholds were tuned on the same predictions, so the figure is optimistic.`
          : ''}
        {' '}Details: docs/MODEL_CARD.md, run {check.run}.
      </p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function About({ link }) {
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { getJSON('/api/model').then(setModel).catch(err => setError(err.message)); }, []);

  return (
    <div className="page">
      <h1>About {PROJECT}</h1>

      <div className="abt-top">
        <section className="abt-section">
          <Eyebrow>Mission</Eyebrow>
          <h2>Why we built this</h2>
          <p>
            Millions of Deaf people in India use Indian Sign Language, but few hearing people know it,
            and certified interpreters are scarce.
            SignSpeak is a small step towards everyday conversations — at a counter, a clinic reception
            or a classroom — where a few common signs shown as text and speech in a local language help.
          </p>
          <p>
            We started with a handful of signs and did them carefully.
            Each one is checked against the official ISLRTC dictionary and recorded with consent by
            pseudonymous volunteers. So far two people have recorded, so we can only test each person
            on a model trained on the other.
          </p>
        </section>
        <section className="abt-section">
          <Eyebrow>Limitations</Eyebrow>
          <h2>What it cannot do</h2>
          <ul className="abt-limits">
            <li>Three signs only: HELLO, YES and NO. Single isolated signs, not sentences or ISL grammar.</li>
            <li>THANK_YOU was verified and trained, then withdrawn — perfect on recorded data but unreliable live.</li>
            <li>Phones not supported yet. On the iPhone tested, tracking ran at ~4 fps; the model needs 7 or more.</li>
            <li>No facial expressions — signs that depend on them are excluded by design.</li>
            <li>Lighting, camera angle and signing style all affect results.</li>
            <li>Kannada, Hindi and Tamil wording is awaiting a native-speaker check.</li>
            <li>Not for medical, legal or emergency communication. Not a replacement for an interpreter.</li>
          </ul>
        </section>
      </div>

      <section className="abt-model-section" aria-labelledby="model-heading">
        <Eyebrow>Performance</Eyebrow>
        <h2 id="model-heading">The model</h2>
        {error
          ? <div className="notice error">Could not load the model report: {error}</div>
          : <ModelPanel model={model} />}
      </section>

      <div className="abt-bottom">
        <section className="abt-section">
          <Eyebrow>Privacy</Eyebrow>
          <h2>Your video never leaves your device</h2>
          <p>
            Hand and body tracking runs entirely in your browser.
            Only the positions of about 75 points per frame are sent for recognition.
            They are processed in server memory and not stored.
            Recordings used for training were made by consenting volunteers under pseudonyms.
          </p>
        </section>
        <section className="abt-section">
          <Eyebrow>Team</Eyebrow>
          <h2>{TEAM_NAME}</h2>
          <p className="muted">{EVENT}</p>
          <ul className="abt-team">
            {TEAM.map(t => (
              <li key={t.name}>
                <strong>{t.name}</strong>
                <span className="muted"> — {t.role}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Built with Google MediaPipe, FastAPI and scikit-learn; speech by edge-tts.
            Sign references: ISLRTC videos, linked but never copied.
            AI assistants (OpenAI Codex, ChatGPT, Claude Code) helped write code and documentation;
            people verified the signs and recorded the data.
          </p>
        </section>
      </div>
    </div>
  );
}
