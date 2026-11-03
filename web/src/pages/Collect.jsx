import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLandmarks } from '../lib/useLandmarks.js';
import CameraView from '../lib/CameraView.jsx';
import { APP_VERSION, FRAME_SCHEMA, TAKE_SCHEMA, frameQuality } from '../lib/lm.js';
import { loadTakes, saveTakes, takesToJsonl } from '../lib/takeStore.js';

const PSEUDONYM = /^[A-Za-z0-9_-]{1,48}$/;
const MIN_FRAMES = 15;
const MIN_SPAN_MS = 1380;
const today = () => new Date().toISOString().slice(0, 10).replaceAll('-', '');

export default function Collect() {
  const [config, setConfig] = useState(null);
  const [signs, setSigns] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [signer, setSigner] = useState('');
  const [session, setSession] = useState(`s${today()}`);
  const [consent, setConsent] = useState(false);
  const [label, setLabel] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | countdown | recording | review
  const [count, setCount] = useState(0);
  const [pending, setPending] = useState(null);
  const [takes, setTakes] = useState(loadTakes);
  const [notice, setNotice] = useState(null);
  const capture = useRef(null);
  const timers = useRef([]);

  const onFrame = useCallback(frame => {
    const c = capture.current;
    if (c && frame.t_ms >= c.start && frame.t_ms <= c.start + c.duration) c.frames.push(frame);
  }, []);
  const cam = useLandmarks({ onFrame });

  useEffect(() => {
    Promise.all([fetch('/api/config').then(r => r.json()), fetch('/api/vocabulary').then(r => r.json())])
      .then(([cfg, voc]) => {
        setConfig(cfg);
        setSigns(voc.signs || []);
        setLabel(voc.signs?.[0]?.label || cfg.none_label);
      })
      .catch(err => setLoadError(`Could not reach the server: ${err.message}`));
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const noneLabel = config?.none_label || 'NONE';
  const isNone = label === noneLabel;
  const sign = signs.find(s => s.label === label);
  const mine = useMemo(() => takes.filter(t => t.signer_id === signer), [takes, signer]);
  const countFor = l => mine.filter(t => t.label === l).length;
  const prompts = config?.none_prompts || [];
  const nonePrompt = prompts.length ? prompts[countFor(noneLabel) % prompts.length] : null;
  const ready = cam.status === 'running' && PSEUDONYM.test(signer) && PSEUDONYM.test(session) && consent && label;

  function record() {
    if (!ready || phase !== 'idle') return;
    setNotice(null);
    setPhase('countdown');
    [3, 2, 1].forEach((n, i) => timers.current.push(setTimeout(() => setCount(n), i * 1000)));
    setCount(3);
    timers.current.push(setTimeout(() => {
      setPhase('recording');
      const duration = config?.capture_ms || 2000;
      capture.current = { start: performance.now(), duration, frames: [] };
      timers.current.push(setTimeout(() => {
        const frames = capture.current.frames;
        capture.current = null;
        setPending({ frames, quality: frameQuality(frames), label, prompt: isNone ? nonePrompt : null, duration });
        setPhase('review');
      }, duration + 120));
    }, 3000));
  }

  async function keep() {
    const take = {
      schema: TAKE_SCHEMA, frame_schema: FRAME_SCHEMA, take_id: crypto.randomUUID(),
      label: pending.label, signer_id: signer, session_id: session,
      reference_url: pending.label === noneLabel ? null : sign?.reference_url ?? null,
      none_prompt: pending.label === noneLabel ? pending.prompt?.id ?? null : null,
      app_version: APP_VERSION, recorded_at: new Date().toISOString(), capture_ms: pending.duration,
      consent: true, preview_mirrored: true, frames: pending.frames,
    };
    const next = [...takes, take];
    setTakes(next);
    setPending(null);
    setPhase('idle');
    const stored = saveTakes(next);
    let message = stored ? 'Take kept (saved in this browser).' : 'Take kept in memory only: browser storage is full or blocked. Download your data now.';
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

  function download() {
    const blob = new Blob([takesToJsonl(mine)], { type: 'application/x-ndjson' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `signspeak-takes-${signer}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function deleteMine() {
    if (!window.confirm(`Delete all ${mine.length} takes for ${signer} from this browser? Download first if you need them.`)) return;
    const next = takes.filter(t => t.signer_id !== signer);
    setTakes(next);
    saveTakes(next);
  }

  const valid = pending && pending.quality.frames >= MIN_FRAMES && pending.quality.durationMs >= MIN_SPAN_MS;
  const labels = [...signs.map(s => s.label), noneLabel];
  const target = l => (l === noneLabel ? config?.targets?.none : config?.targets?.per_sign) || 8;
  const columns = Math.max(...labels.map(target), 1);

  return (
    <>
      <h1>Collect sign takes</h1>
      <p className="muted">Each take is 2 seconds of hand and upper-body landmarks. No video or images are saved or sent.
        See docs/COLLECTION_PROTOCOL.md.</p>
      {loadError && <p className="error">{loadError}</p>}

      <div className="panel">
        <div className="row">
          <label>Signer pseudonym <input value={signer} onChange={e => setSigner(e.target.value.trim())} placeholder="e.g. signer07" maxLength={48} /></label>
          <label>Session <input value={session} onChange={e => setSession(e.target.value.trim())} maxLength={48} /></label>
        </div>
        {signer && !PSEUDONYM.test(signer) && <p className="error">Use only letters, digits, _ or -. Never a real name.</p>}
        <label className="row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
          I agree to record hand and upper-body landmark data (no video) under this pseudonym for training SignSpeak.</label>
      </div>

      <CameraView cam={cam} />

      <div className="panel">
        <div className="row">
          <label>What to record{' '}
            <select value={label} onChange={e => setLabel(e.target.value)} disabled={phase !== 'idle'}>
              {signs.map(s => <option key={s.label} value={s.label}>{s.label}{s.verified ? '' : ' (not yet verified)'}</option>)}
              <option value={noneLabel}>{noneLabel}: not a sign</option>
            </select>
          </label>
        </div>
        {!signs.length && config && <p className="warn">No sign has an official reference link yet. Ask a teammate to follow
          docs/HOW_TO_VERIFY_A_SIGN.md step 2. You can still record NONE takes.</p>}
        {sign && (
          <div>
            <p>Copy the official form: <a href={sign.reference_url} target="_blank" rel="noreferrer">{sign.reference_id || sign.reference_url}</a>
              {sign.hand_count ? ` · ${sign.hand_count} hand${sign.hand_count > 1 ? 's' : ''}` : ''}</p>
            {sign.notes && <p>Notes: {sign.notes}</p>}
            {!sign.verified && <p className="warn">Not verified yet. You can record it now; training will refuse this label until a reviewer verifies it.</p>}
          </div>
        )}
        {isNone && nonePrompt && <p><strong>NONE prompt:</strong> {nonePrompt.text}</p>}

        {phase === 'idle' && <button onClick={record} disabled={!ready}>Record take</button>}
        {!ready && phase === 'idle' && <span className="muted"> Start the camera, enter a pseudonym and session, and tick consent.</span>}
        {phase === 'countdown' && <div className="countdown" aria-live="assertive">{count}</div>}
        {phase === 'recording' && <div className="countdown" aria-live="assertive">● Recording…</div>}
        {phase === 'review' && pending && (
          <div>
            <p>{pending.label}: {pending.quality.frames} frames over {(pending.quality.durationMs / 1000).toFixed(2)} s ·
              hands visible {(pending.quality.handRate * 100).toFixed(0)}% · upper body visible {(pending.quality.poseRate * 100).toFixed(0)}%</p>
            {!valid && <p className="error">Too few frames (the camera or computer is too slow). Discard and try again with better light.</p>}
            {valid && pending.label !== noneLabel && pending.quality.handRate < 0.5 && <p className="warn">Hands were often not visible. Consider discarding.</p>}
            {valid && pending.quality.poseRate < 0.5 && <p className="warn">Shoulders were often not visible. Sit further back.</p>}
            <button onClick={keep} disabled={!valid}>Keep</button> <button onClick={discard}>Discard</button>
          </div>
        )}
        {notice && <p className="muted" role="status">{notice}</p>}
      </div>

      {signer && PSEUDONYM.test(signer) && (
        <div className="panel">
          <h2>Progress for {signer}</h2>
          <table className="grid">
            <tbody>
              {labels.map(l => (
                <tr key={l}>
                  <th>{l}</th>
                  {Array.from({ length: columns }, (_, i) => (
                    <td key={i} className={i < countFor(l) ? 'done' : ''}>{i < target(l) ? i + 1 : ''}</td>
                  ))}
                  <td>{countFor(l)}/{target(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button onClick={download} disabled={!mine.length}>Download my data ({mine.length} takes)</button>
            <button onClick={deleteMine} disabled={!mine.length}>Delete my local data</button>
          </div>
          <p className="muted">Send the downloaded .jsonl file to the team. It is merged with scripts/merge_takes.py.</p>
        </div>
      )}
    </>
  );
}
