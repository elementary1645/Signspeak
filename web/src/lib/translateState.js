// Maps camera/transport/server status to what /translate shows. Pure, unit-tested.
export const STATE_TEXT = {
  INITIALIZING: 'Starting…', READY: 'Ready', DETECTING: 'Hands detected', RECOGNIZING: 'Recognising…',
  RECOGNIZED: 'Recognised', UNKNOWN: 'Not a known sign', NO_HAND: 'No hands in view', ERROR: 'Error',
};

const PLACEHOLDER = {
  INITIALIZING: 'Starting…', READY: 'Start the camera to begin', DETECTING: 'Watching your hands…',
  RECOGNIZING: 'Recognising…', UNKNOWN: 'Not a sign I know', NO_HAND: 'Show your hands to the camera', ERROR: '—',
};

export function viewState({ camStatus, transport, status, result, backendDown }) {
  const code = result?.code || (status && !status.ready ? status.code : null);
  const notTrained = code === 'MODEL_NOT_TRAINED';
  const incompatible = code === 'MODEL_INCOMPATIBLE';
  let state;
  if (backendDown) state = 'ERROR';
  else if (camStatus === 'loading' || (camStatus === 'running' && (transport === 'connecting' || !result))) state = 'INITIALIZING';
  else if (camStatus !== 'running') state = status?.ready ? 'READY' : status ? 'ERROR' : 'INITIALIZING';
  else state = result.state;
  if (camStatus === 'error') state = 'ERROR';
  let badge = STATE_TEXT[state];
  if (state === 'ERROR') badge = backendDown ? 'Server unreachable' : notTrained ? 'Model not trained' : camStatus === 'error' ? 'Camera problem' : 'Error';
  const placeholder = state === 'ERROR' && notTrained ? 'Recognition is off until a model is trained' : PLACEHOLDER[state] || '—';
  return { state, badge, placeholder, notTrained, incompatible };
}
