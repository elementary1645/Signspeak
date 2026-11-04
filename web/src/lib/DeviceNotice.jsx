import { useEffect, useRef, useState } from 'react';
import { SLOW_FPS_MIN, SlowFpsWatch, UNSUPPORTED_DEVICE_TEXT, browserEnv, isPhoneOrTablet } from './deviceSupport.js';

// True once the running tracker has stayed below minFps for ~5 s. While running, "no fps yet" counts
// as 0: a tracker that never delivers two fresh frames a second is too slow too.
export function useSlowTracker(cam, minFps = SLOW_FPS_MIN) {
  const watch = useRef(null);
  const fpsRef = useRef(null);
  const [slow, setSlow] = useState(false);
  fpsRef.current = cam.stats?.fps;
  const running = cam.status === 'running';
  useEffect(() => {
    watch.current = new SlowFpsWatch({ minFps: minFps || SLOW_FPS_MIN });
    setSlow(false);
    if (!running) return undefined;
    const timer = setInterval(() => {
      const fps = typeof fpsRef.current === 'number' ? fpsRef.current : 0;
      if (watch.current.update(performance.now(), fps)) { setSlow(true); clearInterval(timer); }
    }, 1000);
    return () => clearInterval(timer);
  }, [running, minFps]);
  return slow;
}

// Non-blocking notice. Shown on phones/tablets, or when the tracker measured too slow (slow=true).
export default function DeviceNotice({ slow = false, fps = null }) {
  const [mobile] = useState(() => isPhoneOrTablet(browserEnv()));
  if (!mobile && !slow) return null;
  return (
    <p className="notice warn" role="status" data-testid="device-notice">
      <strong>{UNSUPPORTED_DEVICE_TEXT}</strong>
      {slow && <> Tracking on this device stayed below {SLOW_FPS_MIN} FPS{typeof fps === 'number' ? ` (now ${fps.toFixed(1)} fps)` : ''}.</>}
      {' '}You can keep using the page, but recognition will not work reliably.
    </p>
  );
}
