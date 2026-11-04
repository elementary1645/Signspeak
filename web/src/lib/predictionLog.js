// Local-only debug readout for /translate: the last few recognition messages, newest first.
// Display only. Never sent anywhere, never used by recognition, rules or thresholds.
export const LOG_SIZE = 10;

// One server prediction message -> one log row.
export function fromPrediction(message) {
  return {
    source: 'server', t_ms: message.t_ms ?? null, state: message.state, label: message.label ?? null,
    confidence: typeof message.confidence === 'number' ? message.confidence : null,
    margin: typeof message.margin === 'number' ? message.margin : null,
    reason: message.code || message.detail || null, event: message.event ?? null, count: 1,
  };
}

// The browser withheld a frame (uncertain hand evidence or a stale tracker result) and reset the session.
export function fromBrowserUncertain(details) {
  const reasons = details?.state === 'stale' ? ['stale-tracker-result']
    : [...new Set((details?.raw || []).filter(d => d.status !== 'accepted').map(d => d.reason).filter(Boolean))];
  return {
    source: 'browser', t_ms: details?.t_ms ?? null, state: 'UNCERTAIN_HANDS', label: null, confidence: null,
    margin: null, reason: `${reasons.join(', ') || 'uncertain'} · session reset`, event: null, count: 1,
  };
}

// Newest first. Consecutive browser-uncertain rows with the same reason merge into one row with a count,
// so a burst of uncertain frames does not push the server predictions out of view.
export function appendLog(log, entry, size = LOG_SIZE) {
  const [last, ...rest] = log;
  if (last && entry.source === 'browser' && last.source === 'browser' && last.reason === entry.reason) {
    return [{ ...last, t_ms: entry.t_ms, count: last.count + 1 }, ...rest];
  }
  return [entry, ...log].slice(0, size);
}
