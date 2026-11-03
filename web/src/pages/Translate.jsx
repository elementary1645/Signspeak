import { useCallback, useEffect, useRef, useState } from 'react';
import { useLandmarks } from '../lib/useLandmarks.js';
import CameraView from '../lib/CameraView.jsx';
import { RecognizerClient, wsUrl } from '../lib/recognizerClient.js';
import { LANGUAGES, getJSON, meaningOf, readLanguage, saveLanguage } from '../lib/api.js';
import { InfoIcon, ReplayIcon, SpeakerIcon } from '../lib/icons.jsx';
import { Speaker, readAutoSpeak, saveAutoSpeak } from '../lib/speech.js';
import { viewState, STATE_TEXT } from '../lib/translateState.js';

const TRANSPORT_TEXT = {
  idle: 'Not connected', connecting: 'Connecting…', ws: 'Live connection',
  reconnecting: 'Reconnecting', http: 'Live (HTTP fallback)',
};

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
    const outcome = await speakerRef.current?.speak(label, { lang: language.code, bcp47: language.bcp47, text: meaningOf(translationsRef.current, label, language.code), force });
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
    setLastError(null);
    setBackendDown(false);
    setResult(message);
    if (typeof message.t_ms === 'number') setRtt(performance.now() - message.t_ms);
    if (message.event) {
      const meaning = meaningOf(translationsRef.current, message.event, langRef.current);
      setAnnouncement(`Recognised: ${meaning}`);
      setHistory(h => [{ label: message.event, at: new Date(), confidence: message.confidence }, ...h].slice(0, 8));
      if (autoSpeakRef.current) say(message.event);
    }
  }, [say]);

  const onFrame = useCallback(frame => clientRef.current?.send(frame), []);
  const cam = useLandmarks({ onFrame, requiredFps: status?.ready ? status.model?.fps : null,
    maxSourceFps: status?.ready && status.model?.temporal?.sampling === 'actual-frames' ? status.model.temporal.maxFps : null });

  const modelProtocol = status?.ready ? status.model?.capture_protocol : null;
  const previousProtocol = useRef(modelProtocol);
  useEffect(() => {
    if (previousProtocol.current !== modelProtocol && cam.status === 'running') cam.stop();
    previousProtocol.current = modelProtocol;
  }, [modelProtocol, cam.status, cam.stop]);

  useEffect(() => {
    if (cam.status !== 'running') return undefined;
    const client = new RecognizerClient({ url: wsUrl(window.location), onMessage, onTransport: setTransport });
    clientRef.current = client;
    client.start();
    return () => { client.stop(); clientRef.current = null; setResult(null); setRtt(null); };
  }, [cam.status, onMessage]);

  const statusCode = status && !status.ready ? status.code : null;
  useEffect(() => {
    if (statusCode !== 'MODEL_LOADING') return undefined;
    const timer = setTimeout(() => getJSON('/api/status').then(setStatus).catch(() => {}), 3000);
    return () => clearTimeout(timer);
  }, [statusCode, status]);

  function chooseLanguage(code) { setLang(code); saveLanguage(code); }

  const view = viewState({ camStatus: cam.status, transport: transport.mode, status, result, backendDown });
  const shown = view.state === 'RECOGNIZED' ? result?.label : null;
  const supported = status?.ready ? status.model?.labels || [] : [];
  const unchecked = label => lang !== 'en' && translations[label]?.needs_native_check;

  return (
    <div className="page">
      <h1>Translate</h1>
      {backendDown && <p className="notice error" role="alert"><strong>Can’t reach the SignSpeak server.</strong>
        Check your connection and reload the page. If this is the public demo, it may be waking up. Wait a minute and try again.</p>}
      {!backendDown && view.notTrained && (
        <p className="notice warn" role="status"><strong>Model not trained yet.</strong>
          Recognition turns on after the team has verified signs, collected recordings and trained the model. Until then
          nothing is recognised, and SignSpeak will not guess. You can still try the camera and hand tracking.</p>
      )}
      {!backendDown && view.loading && <p className="notice" role="status"><strong>Loading the trained model…</strong>The server has just started. Recognition begins in a few seconds.</p>}
      {!backendDown && view.incompatible && <p className="notice error" role="status"><strong>Recognition unavailable.</strong>{status?.detail || result?.detail}</p>}

      <div className="translate-layout">
        <div>
          {status?.ready && <p className="muted">Model: {status.model?.schema} · {status.model?.window} frames at {status.model?.fps} FPS.</p>}
          {result?.code === 'INSUFFICIENT_TIMING' && <p className="notice warn" role="status">Tracking FPS is insufficient or uneven. {result.detail}</p>}
          <CameraView cam={cam} label="Mirrored camera preview with hand and upper-body tracking" />
          <p className="hint muted"><InfoIcon className="icon" style={{ width: 22, height: 22, flex: 'none' }} />
            Sit so your hands and shoulders are in view. Make the sign, then hold it for about a second.</p>
        </div>

        <section className="card result" aria-labelledby="result-heading">
          <h2 id="result-heading" className="sr-only">Result</h2>
          <div className="row">
            <span className="badge" data-state={view.state} data-variant={view.notTrained && view.state === 'ERROR' ? 'warn' : undefined} aria-live="polite">{view.badge}</span>
            <span className="muted small">{TRANSPORT_TEXT[transport.mode]}{transport.mode === 'reconnecting' ? ` (${transport.retries}/${transport.max})` : ''}</span>
          </div>
          <div className="row">
          <label className="switch"><input type="checkbox" checked={autoSpeak} onChange={e => { setAutoSpeak(e.target.checked); saveAutoSpeak(e.target.checked); if (!e.target.checked) speakerRef.current?.stop(); }} />
            <SpeakerIcon className="icon" style={{ width: 20, height: 20 }} /> Speak results aloud</label>
          </div>
          {voiceNote && <p className="muted small">{voiceNote}</p>}
          <label className="field" style={{ maxWidth: 260 }}>Meaning in
            <select value={lang} onChange={e => chooseLanguage(e.target.value)}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code} lang={l.bcp47}>{l.name}{l.english ? ` (${l.english})` : ''}</option>)}
            </select>
          </label>

          <div className="output" lang={LANGUAGES.find(l => l.code === lang)?.bcp47}>
            {shown
              ? <p className="meaning">{meaningOf(translations, shown, lang)}</p>
              : <p className="meaning placeholder">{view.placeholder}</p>}
          </div>
          {shown && (
            <div className="row">
              <button className="btn" onClick={() => say(shown, true)} aria-label={`Say ${meaningOf(translations, shown, lang)} again`}><ReplayIcon className="icon" style={{ width: 20, height: 20 }} /> Replay</button>
            </div>
          )}
          {shown && <p className="sign-label">ISL sign: {shown}{unchecked(shown) ? ' · translation awaiting native-speaker check' : ''}</p>}

          {status?.ready && typeof result?.confidence === 'number' && (
            <div className="row">
              <span id="conf-label">Confidence</span>
              <div className="meter" role="meter" aria-labelledby="conf-label" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(result.confidence * 100)}>
                <span style={{ width: `${Math.round(result.confidence * 100)}%` }} />
              </div>
              <span>{Math.round(result.confidence * 100)}%</span>
            </div>
          )}
          <dl className="stats">
            <div><dt>Latency</dt><dd>{rtt != null ? `${rtt.toFixed(0)} ms` : '–'}</dd></div>
            <div><dt>Model</dt><dd>{result?.latency_ms?.model != null ? `${result.latency_ms.model.toFixed(1)} ms` : '–'}</dd></div>
            <div><dt>Camera</dt><dd>{cam.stats.fps != null ? `${cam.stats.fps.toFixed(0)} fps` : '–'}</dd></div>
          </dl>
          {lastError && !backendDown && <p className="notice warn small">{lastError}</p>}

          <h3 style={{ marginTop: 18 }}>Recent</h3>
          {history.length ? (
            <ul className="history">
              {history.map((h, i) => (
                <li key={i}><span lang={LANGUAGES.find(l => l.code === lang)?.bcp47}>{meaningOf(translations, h.label, lang)}</span>
                  <span className="muted small">{h.label} · {h.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></li>
              ))}
            </ul>
          ) : <p className="muted">Nothing recognised yet.</p>}
        </section>
      </div>

      <section className="card" aria-labelledby="supported-heading">
        <h2 id="supported-heading" className="h3">Signs this model recognises</h2>
        {supported.length
          ? <ul className="strip">{supported.map(l => <li key={l}>{meaningOf(translations, l, lang)} <span className="muted small">({l})</span></li>)}</ul>
          : <p className="muted">None yet. <a href="/learn" onClick={link('/learn')}>See which signs are being prepared</a>.</p>}
      </section>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">{announcement}</div>
    </div>
  );
}
