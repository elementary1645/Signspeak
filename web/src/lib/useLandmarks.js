import { useCallback, useEffect, useRef, useState } from 'react';
import { toFrame } from './lm.js';
import { POLICY, validateHands } from './handValidation.js';
import { FpsMeter } from './capture.js';
import { FrameClock, FreshFrame, validResultPair, InferenceCadence, inferenceSize, TimingWindow, TrackerWorker } from './tracking.js';

export function useLandmarks({ onFrame, fps = 15, requiredFps = null, maxSourceFps = null, handValidation = POLICY, onUncertain, diagnosticBuffer = null }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const session = useRef(null);
  const onFrameRef = useRef(onFrame);
  const onUncertainRef = useRef(onUncertain);
  onUncertainRef.current = onUncertain;
  onFrameRef.current = onFrame;
  const [settings, setSettings] = useState({ width: 640, fps, delegate: 'CPU' });
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [lastFrame, setLastFrame] = useState(null);
  const [stats, setStats] = useState({});
  const [logCandidates, setLogCandidates] = useState(false);
  const logCandidatesRef = useRef(false);
  logCandidatesRef.current = logCandidates;
  const [diagnostics, setDiagnostics] = useState(null);
  const overlayMs = useRef(0);
  const onOverlayDraw = useCallback(ms => { overlayMs.current = ms; }, []);

  const stop = useCallback(() => {
    const s = session.current;
    session.current = null; // invalidates pending camera, initialization, bitmap and inference work
    if (s) {
      cancelAnimationFrame(s.loop);
      if (s.videoCallback != null) videoRef.current?.cancelVideoFrameCallback?.(s.videoCallback);
      s.stream?.getTracks().forEach(t => t.stop());
      s.workers?.forEach(w => w.close());
      s.fresh?.close();
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setDiagnostics(null);
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
      s.fresh = new FreshFrame(frame => {
        setLastFrame(frame);
        if (!frame) setDiagnostics({ stale: true, reason: 'No fresh synchronized observation; overlay cleared' });
      });
      let staleResults = 0;
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
            w.request({ type: 'frame', bitmap: bitmaps[i], timestamp, kind: i === 0 ? 'hand' : 'pose' }, [bitmaps[i]])));
          if (!active()) return;
          const detectMs = performance.now() - now;
          const processingStart = performance.now();
          let processMs = 0;
          if (validResultPair(hand, pose, timestamp, performance.now() - now)) {
            const rawFrame = toFrame(timestamp, hand.result, pose.result, input.width, input.height);
            const accepted = validateHands(rawFrame, { ...handValidation, allowHandednessFallback: effectiveFps !== 15 });
            // Diagnostics only: pose elbows 13/14 as [x, y, z, visibility]; never read by admission.
            const details = { ...accepted.diagnostics, poseElbows: rawFrame.pose ? [rawFrame.pose[13], rawFrame.pose[14]] : null,
              t_ms: rawFrame.t_ms, sourceTimestamp: timestamp,
              workerTimestamps: { hand: hand.timestamp, pose: pose.timestamp },
              resultAgeMs: performance.now() - now, input: { width: input.width, height: input.height },
              detectorThresholds: { detection: POLICY.minHandDetectionConfidence, presence: POLICY.minHandPresenceConfidence,
                tracking: POLICY.minTrackingConfidence }, presenceConfidence: null };
            setDiagnostics(details);
            if (logCandidatesRef.current) console.table(details.raw.map(d => ({ t_ms: details.t_ms, handWrist: JSON.stringify(d.handWrist),
              handWristPixels: JSON.stringify(d.handWristPixels), handedness: d.handedness, handednessScore: d.handednessScore,
              poseLeftWrist: JSON.stringify(d.poseWrists[0].coordinates), poseRightWrist: JSON.stringify(d.poseWrists[1].coordinates),
              leftVisibility: d.poseWrists[0].visibility, rightVisibility: d.poseWrists[1].visibility,
              leftDistancePixels: d.poseWrists[0].distancePixels, rightDistancePixels: d.poseWrists[1].distancePixels,
              leftDistanceShoulders: d.poseWrists[0].distanceShoulders, rightDistanceShoulders: d.poseWrists[1].distanceShoulders,
              state: d.status, side: d.side, source: d.sideSource, reason: d.reason, legacyReason: d.legacyReason })));
            if (s.fresh.accept(accepted.frame, now)) {
              // Every consumer receives this exact accepted observation; no rejected raw data escapes.
              if (accepted.diagnostics.recordable) onFrameRef.current?.(accepted.frame);
              else onUncertainRef.current?.({ ...details, t_ms: rawFrame.t_ms });
              meter.add(accepted.frame.t_ms);
            }
            // Copy evidence after the unchanged live consumers. Freezing never gates this loop.
            try { diagnosticBuffer?.append(details); } catch { /* diagnostics must not stop inference */ }
            processMs = performance.now() - processingStart;
          } else {
            staleResults++;
            setLastFrame(null);
            onUncertainRef.current?.({ t_ms: timestamp, state: 'stale' });
            setDiagnostics({ stale: true, reason: 'Expired or mismatched worker result; not recorded' });
          }
          const renderMs = overlayMs.current;
          timings.add({ handMs: hand.ms, poseMs: pose.ms, detectMs, processMs, renderMs, totalMs: performance.now() - now });
          // Timing diagnostics need only 2 updates/s; overlay/status and consumers receive every fresh frame.
          if (now - lastStats >= 500) {
            lastStats = now;
            setStats({ ...timings.summary(), fps: meter.fps(), staleResults, delegate: settings.delegate,
              resolution: `${input.width}×${input.height}`, cameraResolution: `${video.videoWidth}×${video.videoHeight}` });
          }
        } catch (err) { fail(err); }
        finally { busy = false; }
      };
      setStatus('running');
      schedule();
    } catch (err) { fail(err); }
  }, [settings, requiredFps, maxSourceFps, handValidation, diagnosticBuffer, stop]);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    const visibility = () => { if (document.hidden) stop(); };
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', visibility); };
  }, [stop]);
  return { videoRef, canvasRef, status, error, lastFrame, stats, diagnostics, logCandidates, setLogCandidates, onOverlayDraw, settings: { ...settings, fps: requiredFps ?? settings.fps }, requiredFps, setSettings, start, stop };
}
