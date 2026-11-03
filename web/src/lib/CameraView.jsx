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
          {detectMs != null ? ` · ${detectMs.toFixed(0)} ms/frame` : ''}
        </p>
      )}
    </div>
  );
}
