import { useCallback, useEffect, useRef, useState } from 'react';
import { policyMatches } from '../lib/handValidation.js';
import { useLandmarks } from '../lib/useLandmarks.js';
import CameraView from '../lib/CameraView.jsx';
import DeviceNotice, { useSlowTracker } from '../lib/DeviceNotice.jsx';
import { RecognizerClient, wsUrl } from '../lib/recognizerClient.js';
import { LANGUAGES, getJSON, meaningOf, readLanguage, saveLanguage } from '../lib/api.js';
import { InfoIcon, ReplayIcon, SpeakerIcon } from '../lib/icons.jsx';
import { Speaker, readAutoSpeak, saveAutoSpeak } from '../lib/speech.js';
import { viewState, STATE_TEXT, REREADING_TEXT, timingNotice } from '../lib/translateState.js';
import { appendLog, fromBrowserUncertain, fromPrediction } from '../lib/predictionLog.js';

const TRANSPORT_TEXT = {
  idle: 'Not connected', connecting: 'Connecting…', ws: 'Live connection',
  reconnecting: 'Reconnecting', http: 'Live (HTTP fallback)',
};

// ── All logic unchanged from original ────────────────────────────────────────

export default function Translate({ link }) {
  const [status, setStatus] = useState(null);
  const [backendDown, setBackendDown] = useState(false);
  const [translations, setTranslations] = useState({});
  const [lang, setLang] = useState(readLanguage);
  const [transport, setTransport] = useState({ mode: 'idle' });
  const [result, setResult] = useState(null);
  const [rtt, setRtt] = useState(null);
  const [history, setHistory] = useState([]);
  const [announcement, setAnnouncement] = useState('');
  const [lastError, setLastError] = useState(null);
  const [predictionLog, setPredictionLog] = useState([]);
  const resetAtRef = useRef(-Infinity);
  const clientRef = useRef(null);
  const speakerRef = useRef(null);
  const [autoSpeak, setAutoSpeak] = useState(readAutoSpeak);
  const [voiceNote, setVoiceNote] = useState(null);
  const autoSpeakRef = useRef(autoSpeak);
  autoSpeakRef.current = autoSpeak;
  const langRef = useRef(lang);
  const translationsRef = useRef(translations);
  langRef.current = lang;
  translationsRef.current = translations;

  useEffect(() => {
    getJSON('/api/status').then(s => { setStatus(s); setBackendDown(false); }).catch(() => setBackendDown(true));
    getJSON('/api/translations').then(setTranslations).catch(() => {});
    speakerRef.current = new Speaker();
    getJSON('/api/audio').then(a => speakerRef.current?.setAudio(a.available)).catch(() => {});
    return () => speakerRef.current?.stop();
  }, []);

  const say = useCallback(async (label, force = false) => {
    const language = LANGUAGES.find(l => l.code === langRef.current);
    const outcome = await speakerRef.current?.speak(label, {
      lang: language.code, bcp47: language.bcp47,
      text: meaningOf(translationsRef.current, label, language.code), force,
    });
    if (outcome === 'none') setVoiceNote(`No voice for ${language.english || language.name} on this browser. Showing text only.`);
    else if (outcome === 'mp3' || outcome === 'synth') setVoiceNote(null);
  }, []);

  const onMessage = useCallback(message => {
    if (message.type === 'hello') { setStatus(message); setBackendDown(false); return; }
    if (message.type === 'error') {
      setLastError(message.code === 'NETWORK' ? 'The SignSpeak server is not responding.' : `${message.code}: ${message.detail || ''}`);
      if (message.code === 'NETWORK') setBackendDown(true);
      return;
    }
    if (message.type !== 'prediction') return;
    setLastError(null); setBackendDown(false);
    setResult(message);
    setPredictionLog(log => appendLog(log, fromPrediction(message)));
    if (message.code === 'UNCERTAIN_HANDS') resetAtRef.current = performance.now();
    if (typeof message.t_ms === 'number') setRtt(performance.now() - message.t_ms);
    if (message.event) {
      const meaning = meaningOf(translationsRef.current, message.event, langRef.current);
      setAnnouncement(`Recognised: ${meaning}`);
      setHistory(h => [{ label: message.event, at: new Date(), confidence: message.confidence }, ...h].slice(0, 8));
      if (autoSpeakRef.current) say(message.event);
    }
  }, [say]);

  const readyRef = useRef(false);
  const policyMismatch = !!status?.ready && status.model?.schema === 'hp-v2-8fps' && !policyMatches(status.model?.hand_validation);
  readyRef.current = !!status?.ready && !policyMismatch;

  const onUncertain = useCallback(details => {
    resetAtRef.current = performance.now();
    clientRef.current?.reset(details.t_ms);
    speakerRef.current?.stop();
    if (readyRef.current) setResult({ type: 'prediction', state: 'UNCERTAIN_HANDS', code: 'UNCERTAIN_HANDS', label: null });
    if (readyRef.current) setPredictionLog(log => appendLog(log, fromBrowserUncertain(details)));
  }, []);
  const onFrame = useCallback(frame => clientRef.current?.send(frame), []);
  const cam = useLandmarks({
    onFrame, onUncertain,
    requiredFps: status?.ready ? status.model?.fps : null,
    maxSourceFps: status?.ready && status.model?.temporal?.sampling === 'actual-frames' ? status.model.temporal.maxFps : null,
  });

  const modelProtocol = status?.ready ? status.model?.capture_protocol : null;
  const previousProtocol = useRef(modelProtocol);
  useEffect(() => {
    if (previousProtocol.current !== modelProtocol && cam.status === 'running') cam.stop();
    previousProtocol.current = modelProtocol;
  }, [modelProtocol, cam.status, cam.stop]);

  useEffect(() => {
    if (cam.status !== 'running' || policyMismatch) return undefined;
    const client = new RecognizerClient({ url: wsUrl(window.location), onMessage, onTransport: setTransport });
    clientRef.current = client;
    client.start();
    return () => { client.stop(); clientRef.current = null; setResult(null); setRtt(null); };
  }, [cam.status, onMessage, policyMismatch]);

  const statusCode = status && !status.ready ? status.code : null;
  useEffect(() => {
    if (statusCode !== 'MODEL_LOADING') return undefined;
    const timer = setTimeout(() => getJSON('/api/status').then(setStatus).catch(() => {}), 3000);
    return () => clearTimeout(timer);
  }, [statusCode, status]);

  function chooseLanguage(code) { setLang(code); saveLanguage(code); }

  const displayStatus = policyMismatch
    ? { ...status, ready: false, code: 'MODEL_INCOMPATIBLE',
        detail: 'Browser and model observation policies differ. Rebuild/restart both before recognition.' }
    : status;
  const view = viewState({ camStatus: cam.status, transport: transport.mode, status: displayStatus, result, backendDown });
  const shown = view.state === 'RECOGNIZED' ? result?.label : null;
  const contract = status?.model?.temporal || {};
  const notice = timingNotice({
    code: result?.code, sinceResetMs: performance.now() - resetAtRef.current,
    fps: cam.stats.fps, minFps: contract.minFps, maxFps: contract.maxFps,
  });
  const slowTracker = useSlowTracker(cam, contract.minFps);
  const supported = status?.ready ? status.model?.labels || [] : [];
  const unchecked = label => lang !== 'en' && translations[label]?.needs_native_check;
  const currentLang = LANGUAGES.find(l => l.code === lang);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <h1 className="sr-only">Translate</h1>

      {/* Full-width alerts shown above the workspace */}
      <DeviceNotice slow={slowTracker} fps={cam.stats.fps} />
      {backendDown && (
        <div className="notice error tl-alert" role="alert">
          <strong>Can't reach the SignSpeak server.</strong>{' '}
          Check your connection and reload. If this is the public demo, it may be waking up — wait a minute and try again.
        </div>
      )}
      {!backendDown && view.notTrained && (
        <div className="notice warn tl-alert" role="status">
          <strong>Model not trained yet.</strong>{' '}
          Recognition turns on after the team has verified signs, collected recordings and trained the model.
          Until then nothing is recognised. You can still try the camera and hand tracking.
        </div>
      )}
      {!backendDown && view.loading && (
        <div className="notice tl-alert" role="status">
          <strong>Loading the trained model…</strong>{' '}
          The server has just started. Recognition begins in a few seconds.
        </div>
      )}
      {!backendDown && view.incompatible && (
        <div className="notice error tl-alert" role="status">
          <strong>Recognition unavailable.</strong>{' '}
          {displayStatus?.detail || result?.detail}
        </div>
      )}

      {/* Two-column workspace */}
      <div className="tl-workspace">

        {/* ── Left: camera ── */}
        <div className="tl-camera-col">
          <CameraView cam={cam} label="Mirrored camera preview with hand and upper-body tracking" />

          {/* Inline camera-state notices */}
          {result?.code === 'UNCERTAIN_HANDS' && (
            <div className="notice warn tl-cam-notice" role="status">
              Hand detection is uncertain — recognition is paused. Check the diagnostics below.
            </div>
          )}
          {notice === 'rereading' && (
            <div className="notice tl-cam-notice" role="status">{REREADING_TEXT}</div>
          )}
          {notice === 'fps' && cam.stats.fps != null && (
            <div className="notice warn tl-cam-notice" role="status">
              Tracking FPS is too low ({cam.stats.fps.toFixed(1)} fps). {result?.detail}
            </div>
          )}

          {/* Tip */}
          <p className="tl-tip muted">
            <InfoIcon aria-hidden="true" style={{ width: 18, height: 18, flex: 'none', verticalAlign: 'text-bottom' }} />
            {' '}Sit so your hands and shoulders are in frame. Make the sign, then hold it for about a second.
          </p>

          {/* Model meta — unobtrusive */}
          {status?.ready && (
            <p className="tl-meta muted">
              Model: {status.model?.schema} · {status.model?.window} frames at {status.model?.fps} FPS
            </p>
          )}
        </div>

        {/* ── Right: result panel ── */}
        <section className="tl-result-col" aria-labelledby="result-heading">
          <h2 id="result-heading" className="sr-only">Recognition result</h2>

          {/* Status + transport row */}
          <div className="tl-status-row">
            <span className="badge" data-state={view.state}
              data-variant={view.notTrained && view.state === 'ERROR' ? 'warn' : undefined}
              aria-live="polite">{view.badge}</span>
            <span className="tl-transport muted">
              {TRANSPORT_TEXT[transport.mode]}
              {transport.mode === 'reconnecting' ? ` (${transport.retries}/${transport.max})` : ''}
            </span>
          </div>

          {/* Big result output */}
          <div className="tl-output" lang={currentLang?.bcp47}>
            {shown
              ? <p className="meaning">{meaningOf(translations, shown, lang)}</p>
              : <p className="meaning placeholder">{view.placeholder}</p>}
          </div>

          {/* ISL label + native-check note */}
          {shown && (
            <p className="sign-label tl-sign-label">
              ISL: {shown}
              {unchecked(shown) && <span className="muted"> · translation awaiting native-speaker check</span>}
            </p>
          )}

          {/* Replay button */}
          {shown && (
            <button className="btn tl-replay" onClick={() => say(shown, true)}
              aria-label={`Say ${meaningOf(translations, shown, lang)} again`}>
              <ReplayIcon aria-hidden="true" style={{ width: 18, height: 18 }} /> Replay
            </button>
          )}

          {/* Confidence meter — only when model is active and we have a number */}
          {status?.ready && typeof result?.confidence === 'number' && (
            <div className="tl-confidence">
              <span id="conf-label" className="tl-conf-label">Confidence</span>
              <div className="meter" role="meter" aria-labelledby="conf-label"
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={Math.round(result.confidence * 100)}>
                <span style={{ width: `${Math.round(result.confidence * 100)}%` }} />
              </div>
              <span className="tl-conf-pct">{Math.round(result.confidence * 100)}%</span>
            </div>
          )}

          {/* Controls row: language + speak */}
          <div className="tl-controls">
            <label className="field tl-lang-field">
              <span>Meaning in</span>
              <select value={lang} onChange={e => chooseLanguage(e.target.value)}>
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code} lang={l.bcp47}>
                    {l.name}{l.english ? ` (${l.english})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="switch tl-speak-switch">
              <input type="checkbox" checked={autoSpeak}
                onChange={e => {
                  setAutoSpeak(e.target.checked);
                  saveAutoSpeak(e.target.checked);
                  if (!e.target.checked) speakerRef.current?.stop();
                }} />
              <SpeakerIcon aria-hidden="true" style={{ width: 18, height: 18 }} />
              Speak aloud
            </label>
          </div>
          {voiceNote && <p className="muted tl-voice-note">{voiceNote}</p>}

          {/* Latency stats */}
          <dl className="stats tl-stats">
            <div><dt>Round-trip</dt><dd>{rtt != null ? `${rtt.toFixed(0)} ms` : '–'}</dd></div>
            <div><dt>Model</dt><dd>{result?.latency_ms?.model != null ? `${result.latency_ms.model.toFixed(1)} ms` : '–'}</dd></div>
            <div><dt>Camera</dt><dd>{cam.stats.fps != null ? `${cam.stats.fps.toFixed(0)} fps` : '–'}</dd></div>
          </dl>

          {lastError && !backendDown && (
            <div className="notice warn tl-error-note">{lastError}</div>
          )}

          {/* Recognition history */}
          <div className="tl-history-block">
            <h3 className="tl-history-heading">Recent</h3>
            {history.length ? (
              <ul className="history">
                {history.map((h, i) => (
                  <li key={i}>
                    <span lang={currentLang?.bcp47}>{meaningOf(translations, h.label, lang)}</span>
                    <span className="muted small">
                      {h.label} · {h.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Nothing recognised yet.</p>}
          </div>

          {/* Debug log — collapsible */}
          <details className="prediction-log tl-debug">
            <summary>Debug: last {predictionLog.length} predictions</summary>
            <p className="muted small">
              Local only — not sent or saved. A sign appears after 3 agreeing accepted predictions over ≥ 0.5 s;
              a browser reset restarts the 16-frame window.
            </p>
            {predictionLog.length ? (
              <div className="table-wrap">
                <table className="table small" aria-label="Last predictions">
                  <thead>
                    <tr>
                      <th scope="col">t (s)</th><th scope="col">From</th><th scope="col">State</th>
                      <th scope="col">Label</th><th scope="col">Conf.</th><th scope="col">Margin</th><th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {predictionLog.map((p, i) => (
                      <tr key={i}>
                        <td>{p.t_ms != null ? (p.t_ms / 1000).toFixed(2) : '–'}</td>
                        <td>{p.source}{p.count > 1 ? ` ×${p.count}` : ''}</td>
                        <td>{p.state}{p.event ? ' · emitted' : ''}</td>
                        <td>{p.label || (p.topLabel ? `– (top: ${p.topLabel} ${p.topConfidence != null ? p.topConfidence.toFixed(3) : ''})` : '–')}</td>
                        <td>{p.confidence != null ? p.confidence.toFixed(3) : '–'}</td>
                        <td>{p.margin != null ? p.margin.toFixed(3) : '–'}</td>
                        <td>{p.reason || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted small">No predictions yet.</p>}
          </details>
        </section>
      </div>

      {/* Supported signs strip — below the workspace */}
      <section className="tl-supported" aria-labelledby="supported-heading">
        <h2 id="supported-heading" className="tl-supported-heading">Signs this model recognises</h2>
        {supported.length
          ? <ul className="strip">{supported.map(l => (
              <li key={l}>{meaningOf(translations, l, lang)} <span className="muted small">({l})</span></li>
            ))}</ul>
          : <p className="muted">None yet. <a href="/learn" onClick={link('/learn')}>See which signs are being prepared</a>.</p>}
      </section>

      {/* Live screen-reader announcements */}
      <div className="sr-only" aria-live="assertive" aria-atomic="true">{announcement}</div>
    </div>
  );
}
