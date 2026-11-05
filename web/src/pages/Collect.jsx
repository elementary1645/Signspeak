import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POLICY, policyMatches, validateSequence } from '../lib/handValidation.js';
import { startBlockMessage } from '../lib/framing.js';
import { TakeDiagnosticsLog } from '../lib/takeDiagnostics.js';
import { useLandmarks } from '../lib/useLandmarks.js';
import CameraView from '../lib/CameraView.jsx';
import DiagnosticCapture from '../lib/DiagnosticCapture.jsx';
import { DiagnosticBuffer } from '../lib/diagnosticBuffer.js';
import { APP_VERSION, FRAME_SCHEMA, TAKE_SCHEMA, frameQuality } from '../lib/lm.js';
import { CAPTURE_MAX_MS, DEFAULT_PROTOCOL, PROTOCOLS, captureDone, sessionSummary, takeVerdict, timingInstructions } from '../lib/capture.js';
import { deleteTakes, loadTakes, saveTake, takesToJsonl } from '../lib/takeStore.js';

const PSEUDONYM = /^[A-Za-z0-9_-]{1,48}$/;
const today = () => new Date().toISOString().slice(0, 10).replaceAll('-', '');

// ── All logic is unchanged from the original ─────────────────────────────

export default function Collect() {
  const [config, setConfig] = useState(null);
  const [signs, setSigns] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [signer, setSigner] = useState('');
  const [session, setSession] = useState(`s${today()}`);
  const [consent, setConsent] = useState(false);
  const [label, setLabel] = useState('');
  const [protocol, setProtocol] = useState(DEFAULT_PROTOCOL);
  const spec = PROTOCOLS[protocol];
  const [phase, setPhase] = useState('idle'); // idle | countdown | recording | review
  const [count, setCount] = useState(0);
  const [pending, setPending] = useState(null);
  const [takes, setTakes] = useState([]);
  const [storage, setStorage] = useState({ loaded: false, persistent: false, migrated: 0 });
  const [notice, setNotice] = useState(null);
  const [startBlock, setStartBlock] = useState(null);
  const [takeDiagnostics, setTakeDiagnostics] = useState(null);
  const takeLog = useRef(null);
  const capture = useRef(null);
  const diagnosticBuffer = useRef(null);
  if (!diagnosticBuffer.current) diagnosticBuffer.current = new DiagnosticBuffer(100);
  const timers = useRef([]);

  const finish = useCallback(() => {
    const c = capture.current;
    if (!c) return;
    capture.current = null;
    clearTimeout(c.safety);
    const frames = c.frames;
    const durationMs = Math.round(Math.min(CAPTURE_MAX_MS, performance.now() - c.start));
    const verdict = { ...takeVerdict(frames, c.protocol), uncertainFrames: c.uncertainFrames };
    verdict.handEvidence = c.protocol !== 'hp-v2-8fps-timed-1' || validateSequence(frames).every(r => r.diagnostics.recordable);
    verdict.valid = verdict.valid && !c.uncertainFrames && verdict.handEvidence;
    const log = takeLog.current;
    if (log) {
      log.close(performance.now());
      setTimeout(() => {
        if (takeLog.current === log) takeLog.current = null;
        setTakeDiagnostics(log.finish({ label: c.label, protocol: c.protocol, verdict }));
      }, 0);
    }
    setPending({ frames, quality: frameQuality(frames), verdict, protocol: c.protocol, label: c.label, prompt: c.prompt, durationMs });
    setPhase('review');
  }, []);

  const onFrame = useCallback(frame => {
    const c = capture.current;
    if (!c || frame.t_ms < c.start) return;
    c.frames.push(frame);
    takeLog.current?.addedToTake(frame.t_ms);
    if (captureDone(c.frames, c.start, frame.t_ms, c.protocol)) finish();
  }, [finish]);
  const onUncertain = useCallback(details => {
    const c = capture.current;
    if (c && details.t_ms >= c.start) c.uncertainFrames++;
    if (details.state === 'stale') takeLog.current?.staleResult(details.t_ms);
  }, []);
  const cam = useLandmarks({ onFrame, onUncertain, diagnosticBuffer: diagnosticBuffer.current, requiredFps: spec.fps, maxSourceFps: spec.sampling === 'actual-frames' ? spec.maxFps : null });
  useEffect(() => diagnosticBuffer.current.subscribe(() => {
    if (takeLog.current) takeLog.current.observe(diagnosticBuffer.current.latest());
  }), []);
  const camRef = useRef(cam);
  camRef.current = cam;

  useEffect(() => {
    Promise.all([fetch('/api/config').then(r => r.json()), fetch('/api/vocabulary').then(r => r.json())])
      .then(([cfg, voc]) => {
        setConfig(cfg);
        setSigns(voc.signs || []);
        setLabel(voc.signs?.[0]?.label || cfg.none_label);
      })
      .catch(err => setLoadError(`Could not reach the server: ${err.message}`));
    loadTakes().then(({ takes: saved, persistent, migrated }) => {
      setTakes(saved);
      setStorage({ loaded: true, persistent, migrated });
    });
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const noneLabel = config?.none_label || 'NONE';
  const isNone = label === noneLabel;
  const sign = signs.find(s => s.label === label);
  const mine = useMemo(() => takes.filter(t => t.signer_id === signer), [takes, signer]);
  const countFor = l => mine.filter(t => t.label === l && t.capture_protocol === protocol).length;
  const prompts = config?.none_prompts || [];
  const [promptChoice, setPromptChoice] = useState('auto');
  const keptWithPrompt = id => mine.filter(t => t.label === noneLabel && t.capture_protocol === protocol && t.none_prompt === id).length;
  const chosenPrompt = promptChoice === 'auto' ? null : prompts.find(p => p.id === promptChoice);
  const nonePrompt = chosenPrompt || (prompts.length ? prompts[countFor(noneLabel) % prompts.length] : null);
  const policyCompatible = policyMatches(config?.hand_validation);
  const ready = policyCompatible && cam.status === 'running' && PSEUDONYM.test(signer) && PSEUDONYM.test(session) && consent && label;
  const labels = [...signs.map(s => s.label), noneLabel];
  const targets = config?.targets || { per_sign: 8, none: 16 };
  const summary = sessionSummary(takes, signer, session, labels, targets, noneLabel, protocol);

  function record() {
    if (!ready || phase !== 'idle') return;
    setNotice(null);
    const blocked = startBlockMessage(cam.diagnostics, cam.framingWarn);
    setStartBlock(blocked);
    if (blocked) return;
    takeLog.current = new TakeDiagnosticsLog(performance.now());
    setTakeDiagnostics(null);
    setPhase('countdown');
    [3, 2, 1].forEach((n, i) => timers.current.push(setTimeout(() => setCount(n), i * 1000)));
    setCount(3);
    timers.current.push(setTimeout(() => {
      const late = startBlockMessage(camRef.current.diagnostics, camRef.current.framingWarn);
      if (late) { setStartBlock(late); setPhase('idle'); takeLog.current = null; return; }
      setPhase('recording');
      const start = performance.now();
      if (takeLog.current) takeLog.current.recordingStart = start;
      capture.current = { start, frames: [], uncertainFrames: 0, protocol, label, prompt: isNone ? nonePrompt : null,
                          safety: setTimeout(finish, CAPTURE_MAX_MS + 150) };
    }, 3000));
  }

  async function keep() {
    if (!pending?.verdict.valid) return;
    const take = {
      schema: TAKE_SCHEMA, frame_schema: FRAME_SCHEMA, take_id: crypto.randomUUID(),
      label: pending.label, signer_id: signer, session_id: session,
      reference_url: pending.label === noneLabel ? null : sign?.reference_url ?? null,
      none_prompt: pending.label === noneLabel ? pending.prompt?.id ?? null : null,
      app_version: APP_VERSION, recorded_at: new Date().toISOString(),
      capture_ms: Math.max(500, pending.durationMs),
      consent: true, preview_mirrored: true, capture_protocol: pending.protocol, hand_validation: POLICY.policy,
      low_fps: pending.verdict.lowFps, measured_fps: Math.round(pending.verdict.fps * 10) / 10,
      frames: pending.frames,
    };
    setTakes(current => [...current, take]);
    setPending(null);
    setPhase('idle');
    const stored = await saveTake(take);
    let message = stored ? 'Take kept and autosaved in this browser.'
      : 'Take kept in memory only: browser storage is unavailable. Download your data before closing this page.';
    if (config?.server_save) {
      try {
        const r = await fetch('/api/takes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(take) });
        const body = await r.json();
        message += r.ok ? ` Also saved on the server (${body.file}).` : ` Server save failed: ${body.detail}`;
      } catch (err) { message += ` Server save failed: ${err.message}`; }
    }
    setNotice(message);
  }

  function discard() { setPending(null); setPhase('idle'); setNotice('Take discarded.'); }

  function downloadTakeDiagnostics() {
    if (!takeDiagnostics) return;
    const blob = new Blob([JSON.stringify(takeDiagnostics, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `signspeak-take-diagnostics-${takeDiagnostics.label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function download() {
    const blob = new Blob([takesToJsonl(mine)], { type: 'application/x-ndjson' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `signspeak-takes-${signer}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function clearMine() {
    if (!window.confirm(`Clear all ${mine.length} saved takes for ${signer} from this browser? This cannot be undone. Download them first if they have not been sent to the team.`)) return;
    await deleteTakes(mine.map(t => t.take_id));
    setTakes(current => current.filter(t => t.signer_id !== signer));
    setNotice(`Cleared saved takes for ${signer}.`);
  }

  const shortcuts = useRef(null);
  shortcuts.current = {
    space: () => { if (phase === 'idle' && ready) record(); },
    k: () => { if (phase === 'review' && pending?.verdict.valid) keep(); },
    d: () => { if (phase === 'review' && pending) discard(); },
  };
  useEffect(() => {
    const typing = el => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName));
    const keyOf = e => (e.code === 'Space' ? 'space' : e.key.toLowerCase());
    const handled = e => !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && ['space', 'k', 'd'].includes(keyOf(e));
    function onKeyDown(e) { if (!handled(e)) return; e.preventDefault(); if (!e.repeat) shortcuts.current[keyOf(e)](); }
    function onKeyUp(e) { if (handled(e) && keyOf(e) === 'space') e.preventDefault(); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  const verdict = pending?.verdict;
  const columns = Math.max(...labels.map(l => (l === noneLabel ? targets.none : targets.per_sign)), 1);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <h1>Record sign takes</h1>
      <p className="lede">
        Each take captures hand and upper-body landmark points for up to 3 seconds.
        No video or images are saved or sent. Follow your team's collection protocol.
      </p>

      {/* System alerts */}
      {config && !policyCompatible && (
        <div className="notice error" role="alert">
          Browser and server hand-validation policies differ. Rebuild and restart the server, then refresh before recording.
        </div>
      )}
      {loadError && <div className="notice error" role="alert">{loadError}</div>}
      {storage.loaded && !storage.persistent && (
        <div className="notice warn">
          This browser cannot autosave (storage blocked or private window). Download your data before closing the page.
        </div>
      )}
      {storage.migrated > 0 && (
        <div className="notice ok">Restored {storage.migrated} takes from an earlier version of this page.</div>
      )}

      {/* Studio layout */}
      <div className="col-workspace">

        {/* ── Left: camera + sign selector ── */}
        <div className="col-main">

          {/* Identity card */}
          <section className="col-card" aria-label="Session identity">
            <p className="col-section-label">Session identity</p>
            <div className="row">
              <label className="field">
                Signer pseudonym
                <input value={signer} onChange={e => setSigner(e.target.value.trim())}
                  placeholder="e.g. signer03" maxLength={48} autoComplete="off" />
              </label>
              <label className="field">
                Session ID
                <input value={session} onChange={e => setSession(e.target.value.trim())}
                  maxLength={48} autoComplete="off" />
              </label>
            </div>
            {signer && !PSEUDONYM.test(signer) && (
              <p className="notice error small">Use only letters, digits, _ or –. Never a real name.</p>
            )}
            <label className="check">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
              I agree to record hand and upper-body landmark data (no video) under this pseudonym for training SignSpeak.
            </label>
          </section>

          {/* Protocol */}
          <section className="col-card" aria-label="Capture protocol">
            <p className="col-section-label">Capture protocol</p>
            <label>
              <select aria-label="Collection protocol" value={protocol}
                disabled={phase !== 'idle' || cam.status === 'running' || cam.status === 'loading'}
                onChange={e => setProtocol(e.target.value)}>
                <option value="hp-v2-8fps-timed-1">hp-v2-8fps — 16 frames, ~2 seconds (recommended)</option>
                <option value="hp-v1-timed-1">hp-v1 — 24-frame window at 15 FPS</option>
              </select>
            </label>
            <p className="muted small">{timingInstructions(protocol)} Use CPU on the tested laptop. Keep hands and shoulders visible.</p>
          </section>

          {/* Sign selector */}
          <section className="col-card" aria-label="Sign selection">
            <p className="col-section-label">What to record</p>
            <label className="field">
              Sign
              <select value={label} onChange={e => setLabel(e.target.value)} disabled={phase !== 'idle'}>
                {signs.map(s => (
                  <option key={s.label} value={s.label}>{s.label}{s.verified ? '' : ' (not yet verified)'}</option>
                ))}
                <option value={noneLabel}>{noneLabel}: not a sign</option>
              </select>
            </label>

            {isNone && prompts.length > 0 && (
              <label className="field" style={{ marginTop: 10 }}>
                NONE prompt
                <select aria-label="NONE prompt" value={promptChoice}
                  onChange={e => setPromptChoice(e.target.value)} disabled={phase !== 'idle'}>
                  <option value="auto">Cycle automatically (next: {prompts[countFor(noneLabel) % prompts.length].id})</option>
                  {prompts.map(p => (
                    <option key={p.id} value={p.id}>{p.id}: {p.text} · {keptWithPrompt(p.id)} kept</option>
                  ))}
                </select>
              </label>
            )}

            {!signs.length && config && (
              <p className="notice warn small">
                No sign has an official reference link yet. A teammate must verify one first (docs/HOW_TO_VERIFY_A_SIGN.md).
                You can still record NONE takes.
              </p>
            )}
            {sign && (
              <div className="col-sign-ref">
                <p>
                  <a href={sign.reference_url} target="_blank" rel="noreferrer">
                    {sign.reference_id || 'Official ISLRTC reference'}
                  </a>
                  {sign.hand_count ? ` · ${sign.hand_count} hand${sign.hand_count > 1 ? 's' : ''}` : ''}
                </p>
                {sign.notes && <p className="muted small">Notes: {sign.notes}</p>}
                {!sign.verified && (
                  <p className="notice warn small">
                    Not verified yet. You can record it now; training will refuse this label until a reviewer verifies it.
                  </p>
                )}
              </div>
            )}

            {cam.stats.fps != null && cam.stats.fps < spec.minFps && (
              <p className="notice warn small">
                Camera running at {cam.stats.fps.toFixed(1)} fps, below {spec.minFps}.
                Close other apps and improve lighting. Takes outside the timing contract cannot be kept.
              </p>
            )}
          </section>
        </div>

        {/* ── Right: camera + record panel ── */}
        <div className="col-camera">
          <CameraView cam={cam} showDiagnostics={false} />

          {/* Record panel */}
          <section className="col-card record-panel" aria-label="Record controls">
            {label && (
              <p className="record-label">
                Next: <strong>{isNone ? `${noneLabel} — not a sign` : label}</strong>
              </p>
            )}
            {isNone && nonePrompt && (
              <p className="col-none-prompt"><strong>Prompt:</strong> {nonePrompt.text}</p>
            )}

            {phase === 'idle' && (
              <button className="btn primary" onClick={record} disabled={!ready} aria-keyshortcuts="Space">
                Record take
              </button>
            )}
            {phase === 'idle' && !ready && (
              <p className="muted small">Start the camera, enter a pseudonym and session, and tick consent.</p>
            )}
            {phase === 'idle' && startBlock && <p className="notice warn" role="alert">{startBlock}</p>}
            {phase === 'countdown' && <div className="countdown" aria-live="assertive">{count}</div>}
            {phase === 'recording' && <div className="countdown" aria-live="assertive">●</div>}

            {phase === 'review' && pending && (
              <div className="col-review">
                {/* Quality readout */}
                <dl className="col-quality">
                  <div><dt>Frames</dt><dd>{pending.quality.frames}</dd></div>
                  <div><dt>Duration</dt><dd>{(pending.quality.durationMs / 1000).toFixed(2)} s</dd></div>
                  <div><dt>FPS</dt><dd>{verdict.fps.toFixed(1)}</dd></div>
                  <div><dt>Hands</dt><dd>{(pending.quality.handRate * 100).toFixed(0)}%</dd></div>
                  <div><dt>Shoulders</dt><dd>{(pending.quality.poseRate * 100).toFixed(0)}%</dd></div>
                </dl>

                {/* Validity notices */}
                {verdict.uncertainFrames > 0 && (
                  <p className="notice error small">Uncertain hand detections. Discard and inspect candidate diagnostics.</p>
                )}
                {verdict.handEvidence === false && !verdict.uncertainFrames && (
                  <p className="notice error small">
                    A hand in the face zone did not enter from outside it within this take. Discard and start with your hands away from your face.
                  </p>
                )}
                {!verdict.valid && !verdict.uncertainFrames && verdict.handEvidence !== false && (
                  <p className="notice error small">Timing contract failed: {timingInstructions(pending.protocol)} Discard and retry.</p>
                )}
                {verdict.valid && verdict.lowFps && (
                  <p className="notice warn small">Low frame rate ({verdict.fps.toFixed(1)} fps). If kept, take is marked low_fps.</p>
                )}
                {verdict.valid && pending.label !== noneLabel && pending.quality.handRate < 0.5 && (
                  <p className="notice warn small">Hands were often not visible. Consider discarding.</p>
                )}
                {verdict.valid && pending.quality.poseRate < 0.5 && (
                  <p className="notice warn small">Shoulders were often not visible. Sit further back.</p>
                )}

                <div className="row">
                  <button className="btn primary" onClick={keep} disabled={!verdict.valid} aria-keyshortcuts="K">Keep</button>
                  <button className="btn" onClick={discard} aria-keyshortcuts="D">Discard</button>
                </div>
              </div>
            )}

            {notice && <p className="muted small" role="status">{notice}</p>}
            <p className="muted kbd-hint">Space: record · K: keep · D: discard</p>

            {takeDiagnostics && (phase === 'review' || phase === 'idle') && (
              <p style={{ marginTop: 10 }}>
                <button className="btn sm" onClick={downloadTakeDiagnostics}>Download take diagnostics</button>
                <span className="muted small"> {takeDiagnostics.observations.length} observations</span>
              </p>
            )}
          </section>
        </div>
      </div>

      {/* Diagnostics capture tool — unchanged inner content */}
      <DiagnosticCapture buffer={diagnosticBuffer.current} logCandidates={cam.logCandidates} setLogCandidates={cam.setLogCandidates} />

      {/* Progress / summary */}
      {signer && PSEUDONYM.test(signer) && (
        <section className="col-card" style={{ marginTop: 24 }} aria-labelledby="summary-heading">
          <h2 id="summary-heading">
            Progress for {signer}
            <span className="muted" style={{ fontWeight: 400, fontSize: 'var(--fs-sm)', marginLeft: 10 }}>{protocol}</span>
          </h2>
          <div className={`notice ${summary.complete ? 'ok' : 'warn'}`} role="status" style={{ marginBottom: 16 }}>
            {summary.complete
              ? `Complete — all targets met (${summary.total} takes). Download the data before you leave.`
              : `Not complete yet. Still needed: ${summary.missing.join(', ')}.`}
            {summary.lowFps > 0 && ` ${summary.lowFps} take${summary.lowFps > 1 ? 's are' : ' is'} marked low_fps.`}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Label</th>
                  <th scope="col">This session</th>
                  <th scope="col">Total</th>
                  <th scope="col">Target</th>
                  <th scope="col">Low fps</th>
                  <th scope="col">Progress</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map(r => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td>{r.thisSession}</td>
                    <td>{r.total}</td>
                    <td>{r.target}</td>
                    <td>{r.lowFps || ''}</td>
                    <td>
                      <span className="progress" aria-label={`${r.total} of ${r.target}`}>
                        {Array.from({ length: columns }, (_, i) => (
                          <span key={i} className={i < r.total ? 'dot on' : i < r.target ? 'dot' : 'dot none'} />
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={download} disabled={!mine.length}>
              Download my data ({mine.length} takes)
            </button>
            <button className="btn danger" onClick={clearMine} disabled={!mine.length}>
              Clear saved takes
            </button>
          </div>
          <p className="muted small">Send the downloaded .jsonl file to the team lead. It is merged with <code>scripts/merge_takes.py</code>.</p>
        </section>
      )}
    </div>
  );
}
