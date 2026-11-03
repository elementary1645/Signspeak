import { displaySides } from './lm.js';

// Video + overlay share one CSS mirror so the preview reads like a mirror while the
// detector keeps receiving unmirrored pixels.
export default function CameraView({ cam }) {
  const sides = cam.lastFrame ? displaySides(cam.lastFrame) : [];
  return (
    <div className="camera">
      <div className="stage">
        <video ref={cam.videoRef} autoPlay muted playsInline />
        <canvas ref={cam.canvasRef} />
      </div>
      <div className="row">
        {cam.status === 'running'
          ? <button onClick={cam.stop}>Stop camera</button>
          : <button onClick={cam.start} disabled={cam.status === 'loading'}>
              {cam.status === 'loading' ? 'Loading camera and models…' : 'Start camera'}
            </button>}
        {cam.lastFrame && (
          <span className="muted">
            Hands: {cam.lastFrame.hands.length ? sides.map(s => (s === 'L' ? 'your left' : s === 'R' ? 'your right' : 'side unknown')).join(' + ') : 'none'}
            {' · '}Upper body: {cam.lastFrame.pose ? 'visible' : 'not visible'}
          </span>
        )}
      </div>
      {cam.error && <p className="error" role="alert">{cam.error}</p>}
    </div>
  );
}
