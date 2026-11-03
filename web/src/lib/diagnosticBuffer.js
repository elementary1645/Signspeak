// Diagnostic evidence only. Never used by admission, features, take storage or transport.
export class DiagnosticBuffer {
  constructor(capacity = 100) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Diagnostic capacity must be a positive integer');
    this.capacity = capacity;
    this.entries = new Array(capacity);
    this.next = 0;
    this.size = 0;
    this.version = 0;
    this.listeners = new Set();
  }
  subscribe = listener => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = () => this.version;
  append(observation) {
    const snapshot = structuredClone(observation);
    this.entries[this.next] = snapshot;
    this.next = (this.next + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
    this.version++;
    for (const listener of this.listeners) {
      // A failed diagnostic viewer must not interrupt the camera's inference loop.
      try { listener(); } catch { /* independent subscriber */ }
    }
  }
  latest() {
    return this.size ? structuredClone(this.entries[(this.next - 1 + this.capacity) % this.capacity]) : null;
  }
  latestFailureB() {
    for (let offset = 1; offset <= this.size; offset++) {
      const observation = this.entries[(this.next - offset + this.capacity) % this.capacity];
      // This identifies a candidate event, not proof that the user's hands were out of view.
      if (observation.rawCount > 0 && observation.acceptedCount === 0) return structuredClone(observation);
    }
    return null;
  }
}
