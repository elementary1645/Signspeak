// The SignSpeak recognition pipeline, as an accessible SVG. Shared by Home and How It Works.
function Box({ x, y, w = 190, title, sub, browser }) {
  return (
    <g>
      <rect className={`box${browser ? ' browser' : ''}`} x={x} y={y} width={w} height={80} rx={10} />
      <text className="label" x={x + w / 2} y={y + 34} textAnchor="middle">{title}</text>
      <text className="sub" x={x + w / 2} y={y + 56} textAnchor="middle">{sub}</text>
    </g>
  );
}

export default function PipelineDiagram() {
  return (
    <svg className="diagram" viewBox="0 0 960 380" role="img" aria-labelledby="dia-title dia-desc">
      <title id="dia-title">SignSpeak pipeline</title>
      <desc id="dia-desc">In the browser: camera, MediaPipe hand and pose tracking, landmark points. These points travel over a
        WebSocket to the Python server, which computes hp-v2-8fps features, runs the classifier with NONE and confidence rejection,
        and smooths the result with a stabilizer. The result returns to the browser as text and speech.</desc>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="currentColor" />
        </marker>
      </defs>
      <rect x="4" y="4" width="952" height="160" rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="2 6" />
      <text className="zone" x="22" y="28">IN YOUR BROWSER · VIDEO STAYS HERE</text>
      <rect x="4" y="214" width="712" height="160" rx={14} fill="none" stroke="var(--line)" strokeWidth={1.5} strokeDasharray="2 6" />
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
