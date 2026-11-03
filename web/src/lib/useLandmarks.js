import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { drawOverlay, toFrame } from './lm.js';
import { FpsMeter } from './capture.js';

// Self-hosted runtime and models: copied/downloaded by our scripts, served same-origin.
const WASM_PATH = '/mediapipe/wasm';
const HAND_MODEL = '/models/hand_landmarker.task';
const POSE_MODEL = '/models/pose_landmarker_lite.task';

let filesetPromise = null;
const detectorCache = {};

async function create(Task, modelAssetPath, extra, delegate) {
  filesetPromise ||= FilesetResolver.forVisionTasks(WASM_PATH).catch(err => { filesetPromise = null; throw err; });
  const fileset = await filesetPromise;
  return Task.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate }, runningMode: 'VIDEO', ...extra });
}

// GPU first, CPU fallback, per landmarker. Output format is identical either way.
async function createWithFallback(Task, model, extra, preferCpu) {
  if (!preferCpu) {
    try {
      return { task: await create(Task, model, extra, 'GPU'), delegate: 'GPU' };
    } catch (err) {
      console.warn(`GPU delegate unavailable for ${model}; using CPU`, err);
    }
  }
  return { task: await create(Task, model, extra, 'CPU'), delegate: 'CPU' };
}

function loadDetectors(preferCpu = false) {
  const key = preferCpu ? 'cpu' : 'auto';
  detectorCache[key] ||= Promise.all([
    createWithFallback(HandLandmarker, HAND_MODEL, { numHands: 2 }, preferCpu),
    createWithFallback(PoseLandmarker, POSE_MODEL, { numPoses: 1 }, preferCpu),
  ]).then(([hand, pose]) => ({ hand, pose }))
    .catch(err => { delete detectorCache[key]; throw err; });
  return detectorCache[key];
}

function cameraError(err) {
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) return { kind: 'insecure', message: 'Camera needs HTTPS or localhost.' };
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return { kind: 'denied', message: 'Camera permission was denied. Allow camera access for this site in your browser settings, then try again.' };
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return { kind: 'no-camera', message: 'No camera was found on this device.' };
  if (err?.name === 'NotReadableError') return { kind: 'busy', message: 'The camera is being used by another app. Close it and try again.' };
  return { kind: 'detector', message: `The hand tracker could not start: ${err?.message || err}` };
}

// Shared camera + landmark loop. Emits lm-v1 frames at ~fps through onFrame.
// status: idle | loading | running | error
export function useLandmarks({ onFrame, fps = 15 }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  const onFrameRef = useRef(onFrame);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [lastFrame, setLastFrame] = useState(null);
  const [stats, setStats] = useState({ fps: null, delegate: null, detectMs: null });
  onFrameRef.current = onFrame;

  const stop = useCallback(() => {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawOverlay(ctx, null);
    setLastFrame(null);
    setStats(s => ({ ...s, fps: null, detectMs: null }));
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    setError(null);
    setStatus('loading');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('getUserMedia unavailable'), { name: 'SecurityError' });
      const [loaded, stream] = await Promise.all([
        loadDetectors(),
        navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false }),
      ]);
      let detectors = loaded;
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      setStatus('running');
      const describe = d => (d.hand.delegate === d.pose.delegate ? d.hand.delegate : `hand ${d.hand.delegate}, pose ${d.pose.delegate}`);
      setStats(s => ({ ...s, delegate: describe(detectors) }));
      const period = 1000 / fps;
      const meter = new FpsMeter();
      let last = -Infinity;
      let lastTs = 0;
      let lastStats = 0;
      let switching = false;
      const tick = () => {
        loopRef.current = requestAnimationFrame(tick);
        const now = performance.now();
        if (switching || now - last < period || video.readyState < 2) return;
        last = now;
        const ts = Math.max(lastTs + 1, Math.round(now)); // VIDEO mode needs increasing timestamps
        lastTs = ts;
        let handResult, poseResult;
        try {
          handResult = detectors.hand.task.detectForVideo(video, ts);
          poseResult = detectors.pose.task.detectForVideo(video, ts);
        } catch (err) {
          if (detectors.hand.delegate === 'CPU' && detectors.pose.delegate === 'CPU') throw err;
          // A GPU context can fail mid-session (driver reset, tab hidden): continue on CPU.
          switching = true;
          console.warn('GPU landmarker failed; switching to CPU', err);
          loadDetectors(true).then(cpu => { detectors = cpu; setStats(s => ({ ...s, delegate: 'CPU (GPU failed)' })); })
            .finally(() => { switching = false; });
          return;
        }
        const detectMs = performance.now() - now;
        const frame = toFrame(ts, handResult, poseResult, video.videoWidth, video.videoHeight);
        const canvas = canvasRef.current;
        if (canvas) {
          if (canvas.width !== frame.w) { canvas.width = frame.w; canvas.height = frame.h; }
          drawOverlay(canvas.getContext('2d'), frame);
        }
        meter.add(frame.t_ms);
        if (now - lastStats > 500) {
          lastStats = now;
          setStats(s => ({ ...s, fps: meter.fps(), detectMs }));
        }
        setLastFrame(frame);
        onFrameRef.current?.(frame);
      };
      loopRef.current = requestAnimationFrame(tick);
    } catch (err) {
      stop();
      setError(cameraError(err));
      setStatus('error');
    }
  }, [fps, stop]);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    window.addEventListener('pagehide', stop);
    return () => window.removeEventListener('pagehide', stop);
  }, [stop]);

  return { videoRef, canvasRef, status, error, lastFrame, stats, start, stop };
}
