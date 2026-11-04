function Box({ x, y, w = 190, title, sub, browser }) {
  return (
    <g>
      <rect className={`box${browser ? ' browser' : ''}`} x={x} y={y} width={w} height={80} rx={10} />
      <text className="label" x={x + w / 2} y={y + 34} textAnchor="middle">{title}</text>
      <text className="sub" x={x + w / 2} y={y + 56} textAnchor="middle">{sub}</text>
    </g>
  );
}

function Diagram() {
  return (
    <svg className="diagram" viewBox="0 0 960 380" role="img" aria-labelledby="dia-title dia-desc">
      <title id="dia-title">SignSpeak pipeline</title>
      <desc id="dia-desc">In the browser: camera, MediaPipe hand and pose tracking, landmark points. These points travel over a
        WebSocket to the Python server, which computes hp-v2-8fps features, runs the classifier with NONE and confidence rejection,
        and smooths the result with a stabilizer. The result returns to the browser as text and speech.</desc>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="currentColor" />
        </marker>
      </defs>
      <rect x="4" y="4" width="952" height="160" rx="14" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2 6" />
      <text className="zone" x="22" y="28">IN YOUR BROWSER · VIDEO STAYS HERE</text>
      <rect x="4" y="214" width="712" height="160" rx="14" fill="none" stroke="var(--line)" strokeWidth="1.5" strokeDasharray="2 6" />
      <text className="zone" x="22" y="364" style={{ fill: 'var(--muted)' }}>ON THE SERVER · PYTHON</text>

      <Box x={20} y={50} title="Camera" sub="video in memory only" browser />
      <Box x={250} y={50} title="MediaPipe" sub="2 hands + upper body" browser />
      <Box x={480} y={50} title="Landmarks" sub="~75 points, 8 per second" browser />
      <Box x={750} y={50} w={190} title="Text and speech" sub="meaning in 4 languages" browser />

      <Box x={20} y={262} title="hp-v2-8fps features" sub="2 s window: shape, motion" />
      <Box x={250} y={262} title="Classifier" sub="+ NONE and threshold reject" />
      <Box x={480} y={262} title="Stabilizer" sub="steady, once per sign" />

      <g style={{ color: 'var(--muted)' }}>
        <path className="edge" d="M210 90H244" markerEnd="url(#arrow)" />
        <path className="edge" d="M440 90H474" markerEnd="url(#arrow)" />
        <path className="edge" d="M210 302H244" markerEnd="url(#arrow)" />
        <path className="edge" d="M440 302H474" markerEnd="url(#arrow)" />
      </g>
      <g style={{ color: 'var(--accent)' }}>
        <path className="wire" d="M575 130V190H115V256" markerEnd="url(#arrow)" />
        <path className="wire" d="M670 302H845V136" markerEnd="url(#arrow)" />
      </g>
      <text className="sub" x="345" y="183" textAnchor="middle" style={{ fill: 'var(--accent)', fontWeight: 700 }}>WebSocket: landmarks only, never images</text>
      <text className="sub" x="855" y="230" style={{ fill: 'var(--accent)', fontWeight: 700 }}>result</text>
    </svg>
  );
}

export default function HowItWorks() {
  return (
    <div className="page">
      <h1>How it works</h1>
      <p className="lede">Your camera picture is turned into points in your browser. Only those points are sent for recognition.</p>
      <div className="card"><Diagram /></div>
      <ol className="steps">
        <li><strong>Your camera stays on your device.</strong> The video is processed in memory by your browser and is never uploaded or saved.</li>
        <li><strong>MediaPipe finds your hands and upper body.</strong> Google’s open-source trackers, running in your browser, mark 21 points
          on each hand and the shoulders, elbows, wrists and nose, about 8 times a second.</li>
        <li><strong>Only the points are sent.</strong> They go to the SignSpeak server over a WebSocket (or plain HTTPS if WebSockets are blocked).</li>
        <li><strong>The server describes the movement.</strong> It looks at the last 16 frames (about 2 seconds): each hand’s shape, where the hands are relative to
          your shoulders, and how they move. This is the hp-v2-8fps feature set, and training uses exactly the same code.</li>
        <li><strong>A classifier picks a sign, or refuses to.</strong> It was trained on recordings of verified signs plus a “NONE” class of resting,
          fidgeting and half-finished movements. If NONE wins, or the model isn’t confident enough, the answer is “not a known sign”.</li>
        <li><strong>A stabilizer waits for a steady answer.</strong> The same sign must win several times in a row before it is shown, and a sign you
          hold is shown once, not repeatedly.</li>
        <li><strong>You see it, and hear it.</strong> The meaning appears in large text in English, Kannada, Hindi or Tamil and can be spoken aloud.</li>
      </ol>
      <p className="muted">The tracker does not read faces, so signs whose meaning depends on facial expression are not included.</p>
    </div>
  );
}
