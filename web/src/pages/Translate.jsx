import { useCallback, useEffect, useRef, useState } from 'react';
import { useLandmarks } from '../lib/useLandmarks.js';
import CameraView from '../lib/CameraView.jsx';
import { RecognizerClient, wsUrl } from '../lib/recognizerClient.js';

const LANGUAGES = [['en', 'English'], ['kn', 'ಕನ್ನಡ'], ['hi', 'हिन्दी'], ['ta', 'தமிழ்']];
const STATE_TEXT = {
  INITIALIZING: 'Starting…', READY: 'Ready', DETECTING: 'Hands detected…', RECOGNIZING: 'Recognizing…',
  RECOGNIZED: 'Recognized', UNKNOWN: 'Not a known sign', NO_HAND: 'No hands visible', ERROR: 'Error',
};
const TRANSPORT_TEXT = {
  idle: 'Not connected', connecting: 'Connecting…', ws: 'Connected (WebSocket)',
  reconnecting: 'Reconnecting', http: 'Connected (HTTP fallback)',
};

function readLanguage() {
  try { return localStorage.getItem('signspeak.lang') || 'en'; } catch { return 'en'; }
}

export default function Translate() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [translations, setTranslations] = useState({});
  const [lang, setLang] = useState(readLanguage);
  const [transport, setTransport] = useState({ mode: 'idle' });
  const [result, setResult] = useState(null);
  const [rtt, setRtt] = useState(null);
  const [history, setHistory] = useState([]);
  const [lastError, setLastError] = useState(null);
  const clientRef = useRef(null);

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(err => setStatusError(err.message));
    fetch('/api/translations').then(r => r.json()).then(setTranslations).catch(() => {});
  }, []);

  const onMessage = useCallback(message => {
    if (message.type === 'hello') { setStatus(message); return; }
    if (message.type === 'error') { setLastError(`${message.code}: ${message.detail || ''}`); return; }
    if (message.type !== 'prediction') return;
    setLastError(null);
    setResult(message);
    if (typeof message.t_ms === 'number') setRtt(performance.now() - message.t_ms);
    if (message.event) setHistory(h => [{ label: message.event, at: new Date(), confidence: message.confidence }, ...h].slice(0, 10));
  }, []);

  const onFrame = useCallback(frame => clientRef.current?.send(frame), []);
  const cam = useLandmarks({ onFrame });

  useEffect(() => {
    if (cam.status !== 'running') return undefined;
    const client = new RecognizerClient({ url: wsUrl(window.location), onMessage, onTransport: setTransport });
    clientRef.current = client;
    client.start();
    return () => { client.stop(); clientRef.current = null; setResult(null); setRtt(null); };
  }, [cam.status, onMessage]);

  function chooseLanguage(value) {
    setLang(value);
    try { localStorage.setItem('signspeak.lang', value); } catch { /* per-viewer convenience only */ }
  }

  const modelReady = result ? result.model_ready : status?.ready;
  const notTrained = (result?.code || status?.code) === 'MODEL_NOT_TRAINED';
  const state = cam.status === 'loading' || transport.mode === 'connecting' ? 'INITIALIZING'
    : cam.status !== 'running' ? (modelReady ? 'READY' : 'ERROR') : result?.state || 'INITIALIZING';
  const shown = state === 'RECOGNIZED' && result?.label ? result.label : null;
  const meaning = label => translations[label]?.[lang] || translations[label]?.en || label;
  const unchecked = label => lang !== 'en' && translations[label]?.needs_native_check;

  return (
    <>
      <h1>Translate</h1>
      {statusError && <p className="error">Server unreachable: {statusError}</p>}
      {status && !modelReady && (
        <div className="panel" role="status">
          <strong>{notTrained ? 'Model not trained yet.' : 'Recognition unavailable.'}</strong>{' '}
          {notTrained ? 'Signs cannot be recognised until a model is trained from collected takes. Nothing will be guessed.'
            : (result?.detail || status.detail)}
        </div>
      )}
      <div className="row">
        <label>Meaning in{' '}
          <select value={lang} onChange={e => chooseLanguage(e.target.value)}>
            {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <span className={`badge ${state}`} aria-live="polite">{notTrained && state === 'ERROR' ? 'Model not trained' : STATE_TEXT[state]}</span>
        <span className="muted">{TRANSPORT_TEXT[transport.mode]}{transport.mode === 'reconnecting' ? ` (${transport.retries}/${transport.max})` : ''}</span>
      </div>

      <CameraView cam={cam} />

      <div className="panel" aria-live="polite">
        {shown ? (
          <>
            <div className="big">{meaning(shown)}</div>
            <div className="muted">{shown}{unchecked(shown) ? ' · translation not yet checked by a native speaker' : ''}</div>
          </>
        ) : (
          <div className="big muted">{state === 'RECOGNIZING' ? '…' : '—'}</div>
        )}
        {modelReady && typeof result?.confidence === 'number' && (
          <div className="row">
            <span>Confidence</span>
            <div className="bar" style={{ width: 200 }}><div style={{ width: `${Math.round(result.confidence * 100)}%` }} /></div>
            <span>{Math.round(result.confidence * 100)}% · margin {Math.round((result.margin ?? 0) * 100)}%</span>
          </div>
        )}
        {result && (
          <p className="muted">
            Latency: model {result.latency_ms?.model != null ? `${result.latency_ms.model.toFixed(1)} ms` : '–'} ·
            server {result.latency_ms?.server != null ? `${result.latency_ms.server.toFixed(1)} ms` : '–'} ·
            round trip {rtt != null ? `${rtt.toFixed(0)} ms` : '–'}
          </p>
        )}
        {lastError && <p className="warn">{lastError}</p>}
        {transport.detail && transport.mode !== 'ws' && <p className="muted">{transport.detail}</p>}
      </div>

      <div className="panel">
        <h2>Recent</h2>
        {history.length ? (
          <ul>{history.map((h, i) => <li key={i}>{h.at.toLocaleTimeString()} · {meaning(h.label)} ({h.label}, {Math.round(h.confidence * 100)}%)</li>)}</ul>
        ) : <p className="muted">Nothing recognised yet.</p>}
      </div>
    </>
  );
}
