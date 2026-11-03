import { displaySides } from './lm.js';

const SIDE = { L: 'your left', R: 'your right', '?': 'side unknown' };

// Video + overlay share one CSS mirror so the preview reads like a mirror while the
// detector keeps receiving unmirrored pixels.
export default function CameraView({ cam, label = 'Camera preview with hand tracking overlay' }) {
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
          <label>Inference FPS <select aria-label="Inference FPS" value={cam.settings.fps} onChange={e => cam.setSettings(s => ({ ...s, fps: Number(e.target.value) }))}>
            {[5, 10, 15, 20, 30].map(n => <option key={n}>{n}</option>)}
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
        {cam.lastFrame && (
          <span className="muted">
            Hands: {cam.lastFrame.hands.length ? sides.map(s => SIDE[s]).join(' + ') : 'none'}
            {' · '}Upper body: {cam.lastFrame.pose ? 'visible' : 'not visible'}
          </span>
        )}
      </div>
      {cam.error && <p className="notice error" role="alert">{cam.error.message}</p>}
      {cam.status === 'running' && (
        <p className="debug" aria-label="Tracker diagnostics">
          {fps != null ? `${fps.toFixed(1)} fps` : '– fps'} · tracker {delegate || '–'}
          {detectMs != null ? ` · ${detectMs.toFixed(1)} ms inference round trip` : ''}
          {cam.stats.handMs != null && <><br />Hands {cam.stats.handMs.toFixed(1)} ms · pose {cam.stats.poseMs.toFixed(1)} ms
            {' · '}processing {cam.stats.processMs.toFixed(1)} ms · overlay draw {cam.stats.renderMs.toFixed(1)} ms
            {' · '}total {cam.stats.totalMs.toFixed(1)} ms (p95 {cam.stats.totalMsP95.toFixed(1)}) · {cam.stats.samples} samples<br />
            Input {cam.stats.resolution} · camera {cam.stats.cameraResolution} · parallel workers</>}
        </p>
      )}
    </div>
  );
}
