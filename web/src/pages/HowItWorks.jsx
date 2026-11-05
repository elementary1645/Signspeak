import PipelineDiagram from '../components/PipelineDiagram.jsx';

export default function HowItWorks() {
  return (
    <div className="page">
      <h1>How it works</h1>
      <p className="lede">
        Your camera picture is turned into a small set of points, inside your browser.
        Only those points are ever sent for recognition — never images or video.
      </p>

      <div className="card hiw-diagram-card"><PipelineDiagram /></div>

      <ol className="steps hiw-steps">
        <li>
          <strong>Your camera stays on your device.</strong>{' '}
          The video is processed in memory by your browser and is never uploaded or saved.
        </li>
        <li>
          <strong>MediaPipe finds your hands and upper body.</strong>{' '}
          Google's open-source trackers, running inside your browser, mark 21 points on each hand and
          the shoulders, elbows, wrists and nose — about 8 times a second.
        </li>
        <li>
          <strong>Only the points are sent.</strong>{' '}
          They travel to the SignSpeak server over a WebSocket (or plain HTTPS if WebSockets are blocked).
          No pixel ever leaves your device.
        </li>
        <li>
          <strong>The server describes the movement.</strong>{' '}
          It looks at the last 16 frames — about 2 seconds — and measures each hand's shape,
          where the hands sit relative to your shoulders, and how they move.
          This is the <em>hp-v2-8fps</em> feature set, and training uses exactly the same code.
        </li>
        <li>
          <strong>A classifier picks a sign, or refuses to.</strong>{' '}
          It was trained on recordings of verified ISL signs plus a "NONE" class of resting,
          fidgeting and half-finished movements.
          If NONE wins, or the model isn't confident enough, the answer is "not a known sign."
        </li>
        <li>
          <strong>A stabiliser waits for a steady answer.</strong>{' '}
          The same sign must win several times in a row before it is shown,
          and a sign you hold is shown once, not repeatedly.
        </li>
        <li>
          <strong>You see it, and hear it.</strong>{' '}
          The meaning appears in large text in English, Kannada, Hindi or Tamil
          and can be spoken aloud.
        </li>
      </ol>

      <div className="hiw-note card">
        <p className="muted">
          The tracker does not read faces, so signs whose meaning depends on facial expression are not included.
          See <a href="/about">About &amp; Model</a> for performance numbers and limitations.
        </p>
      </div>
    </div>
  );
}
