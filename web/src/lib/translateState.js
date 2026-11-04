// Maps camera/transport/server status to what /translate shows. Pure, unit-tested.
export const STATE_TEXT = {
  UNCERTAIN_HANDS: 'Hand detection uncertain',
  INITIALIZING: 'Starting…', READY: 'Ready', DETECTING: 'Hands detected', RECOGNIZING: 'Recognising…',
  RECOGNIZED: 'Recognised', UNKNOWN: 'Not a known sign', NO_HAND: 'No hands in view', ERROR: 'Error',
};

const PLACEHOLDER = {
  UNCERTAIN_HANDS: 'Recognition paused while hand evidence is uncertain',
  INITIALIZING: 'Starting…', READY: 'Start the camera to begin', DETECTING: 'Watching your hands…',
  RECOGNIZING: 'Recognising…', UNKNOWN: 'Not a sign I know', NO_HAND: 'Show your hands to the camera', ERROR: '—',
};

// After any session reset (uncertain or stale frame), the server needs 16 fresh frames (~2 s at 8 FPS)
// before a window exists, and says INSUFFICIENT_TIMING meanwhile. That is not a camera problem.
export const REREAD_MS = 2500;
export const REREADING_TEXT = 'Re-reading your hands after an uncertain detection…';

// Which notice to show for a server timing reply. Display only; recognition is unchanged.
// 'rereading' within REREAD_MS of a reset; 'fps' only if the measured camera fps is outside the
// model's contract; otherwise nothing (a transient gap the next window recovers from).
export function timingNotice({ code, sinceResetMs, fps, minFps = 7, maxFps = 9.5 }) {
  if (code !== 'INSUFFICIENT_TIMING') return null;
  if (sinceResetMs != null && sinceResetMs >= 0 && sinceResetMs < REREAD_MS) return 'rereading';
  if (typeof fps === 'number' && (fps < minFps || fps > maxFps)) return 'fps';
  return null;
}

export function viewState({ camStatus, transport, status, result, backendDown }) {
  const code = result?.code || (status && !status.ready ? status.code : null);
  const notTrained = code === 'MODEL_NOT_TRAINED';
  const incompatible = code === 'MODEL_INCOMPATIBLE';
  const loading = code === 'MODEL_LOADING';
  let state;
  if (backendDown) state = 'ERROR';
  else if (camStatus === 'loading' || (camStatus === 'running' && (transport === 'connecting' || !result))) state = 'INITIALIZING';
  else if (camStatus !== 'running') state = status?.ready ? 'READY' : status ? 'ERROR' : 'INITIALIZING';
  else state = result.state;
  if (camStatus === 'error') state = 'ERROR';
  let badge = STATE_TEXT[state];
  if (state === 'ERROR') badge = backendDown ? 'Server unreachable' : notTrained ? 'Model not trained' : loading ? 'Loading model' : camStatus === 'error' ? 'Camera problem' : 'Error';
  const placeholder = state === 'ERROR' && notTrained ? 'Recognition is off until a model is trained' : PLACEHOLDER[state] || '—';
  return { state, badge, placeholder, notTrained, incompatible, loading };
}
