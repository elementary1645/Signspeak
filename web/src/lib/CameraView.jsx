import { useLayoutEffect } from 'react';
import { drawOverlay, drawUncertainOverlay, displaySides } from './lm.js';

const SIDE = { L: 'your left', R: 'your right', '?': 'side unknown' };

// Video + overlay share one CSS mirror so the preview reads like a mirror while the
// detector keeps receiving unmirrored pixels.
export default function CameraView({ cam, label = 'Camera preview with hand tracking overlay' }) {
  // Draw in the same React commit as the label: neither can describe a different frame.
  useLayoutEffect(() => {
    const canvas = cam.canvasRef.current;
    if (!canvas) return;
    const frame = cam.lastFrame;
    if (frame && (canvas.width !== frame.w || canvas.height !== frame.h)) { canvas.width = frame.w; canvas.height = frame.h; }
    const start = performance.now();
    drawOverlay(canvas.getContext('2d'), frame);
    if (frame) drawUncertainOverlay(canvas.getContext('2d'), cam.diagnostics?.raw);
    cam.onOverlayDraw?.(performance.now() - start);
  }, [cam.lastFrame, cam.diagnostics, cam.canvasRef, cam.onOverlayDraw]);
  const sides = cam.lastFrame ? displaySides(cam.lastFrame) : [];
  const { fps, delegate, detectMs } = cam.stats || {};
  return (
    <div className="camera">
      <div className="stage" role="img" aria-label={label}>
        <video ref={cam.videoRef} autoPlay muted playsInline />
        <canvas ref={cam.canvasRef} />
        {cam.status !== 'running' && (
          <div className="stage-cover">
            {cam.status === 'loading' ? <p>Starting camera and hand tracker…</p>
              : cam.error ? <p>{cam.error.message}</p>
              : <p>Camera is off</p>}
          </div>
        )}
      </div>
      <div className="row camera-controls">
        {cam.settings && <fieldset disabled={cam.status === 'loading' || cam.status === 'running'}>
          <legend>Tracking settings (stop camera to change)</legend>
          <label>Resolution <select aria-label="Resolution" value={cam.settings.width} onChange={e => cam.setSettings(s => ({ ...s, width: Number(e.target.value) }))}>
            <option value={320}>320×240</option><option value={640}>640×480</option><option value={1280}>1280×960</option>
          </select></label>
          <label>Inference FPS <select aria-label="Inference FPS" disabled={cam.requiredFps != null} value={cam.settings.fps} onChange={e => cam.setSettings(s => ({ ...s, fps: Number(e.target.value) }))}>
            {[5, 8, 10, 15, 20, 30].map(n => <option key={n}>{n}</option>)}
          </select></label>
          <label>Delegate <select aria-label="Delegate" value={cam.settings.delegate} onChange={e => cam.setSettings(s => ({ ...s, delegate: e.target.value }))}>
            <option>GPU</option><option>CPU</option>
          </select></label>
        </fieldset>}
        {cam.status === 'running'
          ? <button className="btn" onClick={cam.stop}>Stop camera</button>
          : <button className="btn primary" onClick={cam.start} disabled={cam.status === 'loading'}>
              {cam.status === 'loading' ? 'Starting…' : cam.status === 'error' ? 'Try camera again' : 'Start camera'}
            </button>}
        {cam.status === 'running' && (
          <span className="muted" aria-label="Accepted hand status">
            Hands: {cam.diagnostics?.uncertainCount ? `${cam.lastFrame?.hands.length ? sides.map(s => SIDE[s]).join(' + ') + ' + ' : ''}uncertain (${cam.diagnostics.uncertainCount} candidate; not recorded)`
              : cam.diagnostics?.rejectedCount ? 'invalid candidates (not recorded)'
              : cam.lastFrame?.hands.length ? sides.map(s => SIDE[s]).join(' + ') : cam.lastFrame ? 'none detected' : 'waiting for fresh tracking'}
            {' · '}Body pose: {cam.lastFrame?.pose ? 'detected' : 'not detected'}
          </span>
        )}
      </div>
      {cam.status === 'running' && cam.diagnostics?.rawCount > cam.diagnostics?.acceptedCount && <p className="notice warn">Hand evidence is uncertain or invalid. Dashed yellow landmarks are preview only and cannot be recorded. Missing body landmarks do not mean no hands; inspect the reason below.</p>}
      {cam.status === 'running' && cam.diagnostics && <details>
        <summary>Local hand validation diagnostics</summary>
        <p>Raw handedness score is not a hand-presence confidence. Yellow uncertain previews and invalid observations are never recorded.</p>
        <label><input type="checkbox" checked={cam.logCandidates || false} onChange={e => cam.setLogCandidates?.(e.target.checked)} /> Log candidate summaries in this browser console (local only)</label>
        <pre aria-label="Hand validation diagnostics">{JSON.stringify(cam.diagnostics, null, 2)}</pre>
      </details>}
      {cam.error && <p className="notice error" role="alert">{cam.error.message}</p>}
      {cam.status === 'running' && (
        <p className="debug" aria-label="Tracker diagnostics">
          {fps != null ? `${fps.toFixed(1)} fps` : '– fps'} · tracker {delegate || '–'}
          {detectMs != null ? ` · ${detectMs.toFixed(1)} ms inference round trip` : ''}
          {cam.stats.handMs != null && <><br />Hands {cam.stats.handMs.toFixed(1)} ms · pose {cam.stats.poseMs.toFixed(1)} ms
            {' · '}processing {cam.stats.processMs.toFixed(1)} ms · overlay draw {cam.stats.renderMs.toFixed(1)} ms
            {' · '}total {cam.stats.totalMs.toFixed(1)} ms (p95 {cam.stats.totalMsP95.toFixed(1)}) · {cam.stats.samples} samples<br />
            Input {cam.stats.resolution} · camera {cam.stats.cameraResolution} · parallel workers · stale results dropped: {cam.stats.staleResults ?? 0}</>}
        </p>
      )}
    </div>
  );
}
