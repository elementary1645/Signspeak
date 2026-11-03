import { useCallback, useEffect, useRef, useState } from 'react';
import { drawOverlay, toFrame } from './lm.js';
import { FpsMeter } from './capture.js';
import { FrameClock, InferenceCadence, inferenceSize, TimingWindow, TrackerWorker } from './tracking.js';

export function useLandmarks({ onFrame, fps = 15, requiredFps = null, maxSourceFps = null }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const session = useRef(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const [settings, setSettings] = useState({ width: 640, fps, delegate: 'CPU' });
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [lastFrame, setLastFrame] = useState(null);
  const [stats, setStats] = useState({});

  const stop = useCallback(() => {
    const s = session.current;
    session.current = null; // invalidates pending camera, initialization, bitmap and inference work
    if (s) {
      cancelAnimationFrame(s.loop);
      if (s.videoCallback != null) videoRef.current?.cancelVideoFrameCallback?.(s.videoCallback);
      s.stream?.getTracks().forEach(t => t.stop());
      s.workers?.forEach(w => w.close());
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawOverlay(ctx, null);
    setLastFrame(null);
    setStats({});
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    const effectiveFps = requiredFps ?? settings.fps;
    if (session.current) return; // includes loading, not just a resolved camera stream
    const s = { workers: [], loop: null, stream: null };
    session.current = s;
    const active = () => session.current === s;
    setStatus('loading');
    setError(null);
    const fail = err => {
      if (!active()) return;
      stop();
      setError({ message: `Tracker stopped: ${err.message}. Check camera permission and HTTPS. If GPU initialization failed, select CPU and retry.` });
      setStatus('error');
    };
    try {
      // Acquire sequentially so every late stream and every worker has a cleanup owner.
      const stream = await navigator.mediaDevices.getUserMedia({ video: {
        width: { ideal: settings.width }, height: { ideal: settings.width * 3 / 4 },
        frameRate: { ideal: Math.max(30, effectiveFps) }, facingMode: 'user',
      }, audio: false });
      if (!active()) { stream.getTracks().forEach(t => t.stop()); return; }
      s.stream = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      if (!active()) return;
      for (const kind of ['hand', 'pose']) s.workers.push(new TrackerWorker(kind, settings.delegate));
      await Promise.all(s.workers.map(w => w.ready));
      if (!active()) return;
      const input = document.createElement('canvas');
      const size = inferenceSize(video.videoWidth, video.videoHeight, settings.width);
      input.width = size.width; input.height = size.height;
      const ctx = input.getContext('2d');
      const meter = new FpsMeter(3000);
      const timings = new TimingWindow();
      const clock = new FrameClock();
      const cadence = new InferenceCadence(effectiveFps, maxSourceFps);
      let lastStats = -Infinity;
      let busy = false;
      const schedule = () => {
        if (!active()) return;
        if (video.requestVideoFrameCallback) s.videoCallback = video.requestVideoFrameCallback(tick);
        else s.loop = requestAnimationFrame(tick);
      };
      const tick = async (_callbackTime, metadata) => {
        if (!active()) return;
        schedule();
        const now = performance.now();
        // Polling can be faster than the camera; never infer the same source frame twice.
        const source = metadata?.mediaTime ?? video.currentTime;
        const due = cadence.ready(now, source * 1000);
        if (busy || !due || video.readyState < 2) return;
        const timestamp = clock.timestamp(source, now);
        if (timestamp == null) return;
        busy = true;
        cadence.started(now);
        try {
          ctx.drawImage(video, 0, 0, input.width, input.height);
          // Both tasks see the exact same unmirrored snapshot and capture timestamp.
          const bitmaps = await Promise.all([createImageBitmap(input), createImageBitmap(input)]);
          if (!active()) { bitmaps.forEach(b => b.close()); return; }
          const [hand, pose] = await Promise.all(s.workers.map((w, i) =>
            w.request({ type: 'frame', bitmap: bitmaps[i], timestamp }, [bitmaps[i]])));
          if (!active()) return;
          const detectMs = performance.now() - now;
          const processingStart = performance.now();
          const frame = toFrame(timestamp, hand.result, pose.result, input.width, input.height);
          onFrameRef.current?.(frame);
          const processMs = performance.now() - processingStart;
          const renderStart = performance.now();
          const canvas = canvasRef.current;
          if (canvas) {
            if (canvas.width !== frame.w || canvas.height !== frame.h) { canvas.width = frame.w; canvas.height = frame.h; }
            drawOverlay(canvas.getContext('2d'), frame);
          }
          const renderMs = performance.now() - renderStart;
          meter.add(frame.t_ms);
          timings.add({ handMs: hand.ms, poseMs: pose.ms, detectMs, processMs, renderMs, totalMs: performance.now() - now });
          // React diagnostics/hand status need only 2 updates/s; collector still receives every frame.
          if (now - lastStats >= 500) {
            lastStats = now;
            setLastFrame(frame);
            setStats({ ...timings.summary(), fps: meter.fps(), delegate: settings.delegate,
              resolution: `${input.width}×${input.height}`, cameraResolution: `${video.videoWidth}×${video.videoHeight}` });
          }
        } catch (err) { fail(err); }
        finally { busy = false; }
      };
      setStatus('running');
      schedule();
    } catch (err) { fail(err); }
  }, [settings, requiredFps, maxSourceFps, stop]);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    window.addEventListener('pagehide', stop);
    return () => window.removeEventListener('pagehide', stop);
  }, [stop]);
  return { videoRef, canvasRef, status, error, lastFrame, stats, settings: { ...settings, fps: requiredFps ?? settings.fps }, requiredFps, setSettings, start, stop };
}
