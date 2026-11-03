import { useMemo, useState, useSyncExternalStore } from 'react';

export default function DiagnosticCapture({ buffer, logCandidates, setLogCandidates }) {
  const version = useSyncExternalStore(buffer.subscribe, buffer.getVersion, buffer.getVersion);
  const [frozen, setFrozen] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [message, setMessage] = useState('');
  const observation = useMemo(() => frozen ? snapshot : buffer.latest(), [buffer, version, frozen, snapshot]);
  const json = observation ? JSON.stringify(observation, null, 2) : '';

  function capture(failureB = false) {
    const chosen = failureB ? buffer.latestFailureB() : buffer.latest();
    if (!chosen) {
      setMessage(failureB ? 'No raw-candidate / zero-accepted-hand event remains in the last 100 observations. Keep the camera running and try again.'
        : 'No diagnostic observation yet. Start the camera first.');
      return;
    }
    setSnapshot(chosen);
    setFrozen(true);
    setMessage(failureB ? 'Captured the latest raw-candidate / zero-accepted-hand event. Confirm both real hands were outside view; this button cannot establish that.'
      : 'Diagnostic observation captured in browser memory. Camera and tracking continue.');
  }

  function toggleFreeze() {
    if (frozen) { setFrozen(false); setSnapshot(null); setMessage('Diagnostic display resumed.'); }
    else capture();
  }

  async function copy() {
    if (!frozen || !snapshot) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setMessage('Frozen diagnostic JSON copied. Nothing was uploaded.');
    } catch {
      setMessage('Automatic clipboard access is unavailable. Select the JSON below and copy it manually; the frozen observation is preserved.');
    }
  }

  return <section className="card" aria-labelledby="diagnostic-capture-heading">
    <h2 id="diagnostic-capture-heading">Capture hand diagnostics</h2>
    <p>This is diagnostic evidence, not a training take. The latest 100 observations stay in this page’s memory only.
      Freezing pauses this JSON display; the camera, overlay, validation and collection continue live.</p>
    <div className="row">
      <button type="button" className="btn" onClick={() => capture()}>Capture Diagnostics</button>
      <button type="button" className="btn" onClick={toggleFreeze} disabled={!frozen && !buffer.size}>
        {frozen ? 'Resume Diagnostics' : 'Freeze Diagnostics'}</button>
      <button type="button" className="btn" onClick={() => capture(true)}>Capture Failure B</button>
      <button type="button" className="btn" onClick={copy} disabled={!frozen || !snapshot}>Copy JSON</button>
    </div>
    <p className="muted" aria-label="Diagnostic buffer status">
      {buffer.size}/{buffer.capacity} observations retained · {frozen ? 'Frozen JSON display' : 'Live JSON display'}
      {' · '}Received: {version}
      {observation?.t_ms != null ? ` · Observation t_ms: ${observation.t_ms}` : ''}
    </p>
    {message && <p role="status">{message}</p>}
    <details><summary>Optional local console logging</summary>
    <label><input type="checkbox" checked={logCandidates || false} onChange={e => setLogCandidates(e.target.checked)} />
      Log live candidate summaries in this browser console (local only; independent of frozen JSON)</label>
    </details>
    <textarea aria-label="Diagnostic observation JSON" readOnly value={json} rows={16}
      placeholder="Start the camera, then capture an observation."
      style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }} />
  </section>;
}
