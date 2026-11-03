import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { drawOverlay, toFrame } from './lm.js';

// Self-hosted runtime and models: copied/downloaded by our scripts, served same-origin.
const WASM_PATH = '/mediapipe/wasm';
const HAND_MODEL = '/models/hand_landmarker.task';
const POSE_MODEL = '/models/pose_landmarker_lite.task';

let detectorsPromise = null;
function loadDetectors() {
  if (!detectorsPromise) {
    detectorsPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      const [hand, pose] = await Promise.all([
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' },
          runningMode: 'VIDEO', numHands: 2,
        }),
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' },
          runningMode: 'VIDEO', numPoses: 1,
        }),
      ]);
      return { hand, pose };
    })().catch(err => { detectorsPromise = null; throw err; });
  }
  return detectorsPromise;
}

function cameraError(err) {
  if (err?.name === 'NotAllowedError') return 'Camera permission denied. Allow camera access in the browser and try again.';
  if (err?.name === 'NotFoundError') return 'No camera found.';
  if (err?.name === 'NotReadableError') return 'Camera is in use by another application.';
  if (!window.isSecureContext) return 'Camera needs HTTPS or localhost.';
  return `Camera/detector failed: ${err?.message || err}`;
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
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    setError(null);
    setStatus('loading');
    try {
      const [detectors, stream] = await Promise.all([
        loadDetectors(),
        navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false }),
      ]);
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      setStatus('running');
      const period = 1000 / fps;
      let last = -Infinity;
      let lastTs = 0;
      const tick = () => {
        loopRef.current = requestAnimationFrame(tick);
        const now = performance.now();
        if (now - last < period || video.readyState < 2) return;
        last = now;
        const ts = Math.max(lastTs + 1, Math.round(now)); // VIDEO mode needs increasing timestamps
        lastTs = ts;
        const handResult = detectors.hand.detectForVideo(video, ts);
        const poseResult = detectors.pose.detectForVideo(video, ts);
        const frame = toFrame(ts, handResult, poseResult, video.videoWidth, video.videoHeight);
        const canvas = canvasRef.current;
        if (canvas) {
          if (canvas.width !== frame.w) { canvas.width = frame.w; canvas.height = frame.h; }
          drawOverlay(canvas.getContext('2d'), frame);
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

  return { videoRef, canvasRef, status, error, lastFrame, start, stop };
}
