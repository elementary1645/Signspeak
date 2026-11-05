import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api.js';
import DeviceNotice from '../lib/DeviceNotice.jsx';
import { HandIcon, LanguageIcon, ShieldIcon, SpeakerIcon } from '../lib/icons.jsx';
import { Button, Eyebrow } from '../components/ui';
import PipelineDiagram from '../components/PipelineDiagram.jsx';

export default function Home({ link }) {
  const [signs, setSigns] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { getJSON('/api/signs').then(setSigns).catch(err => setError(err.message)); }, []);

  const recognised = signs?.recognised_count ?? null;
  const verified = signs?.verified?.length ?? null;

  return (
    <div className="page">
      <DeviceNotice />
      <section className="hero">
        <Eyebrow className="hero-eyebrow">Indian Sign Language → text &amp; speech</Eyebrow>
        <h1>Indian Sign Language to text and speech, in your browser.</h1>
        <p className="lede">SignSpeak watches your hands through the camera, recognises signs that have been checked against the
          official ISL dictionary, and shows and speaks their meaning in English, Kannada, Hindi or Tamil.</p>
        <div className="hero-actions">
          <Button variant="primary" size="large" href="/translate" onClick={link('/translate')}>Try SignSpeak</Button>
          <Button size="large" href="/learn" onClick={link('/learn')}>Explore ISL</Button>
        </div>
        <p className="hero-status muted small">
          {signs && (signs.model_ready
            ? `The live model recognises ${recognised} of ${verified} verified sign${verified === 1 ? '' : 's'}.`
            : verified
              ? `${verified} sign${verified === 1 ? ' is' : 's are'} verified; the recognition model has not been trained yet.`
              : 'No sign has been verified against the official dictionary yet, so nothing is recognised.')}
          {error && ` Could not reach the server: ${error}`}
        </p>
      </section>

      <section className="section">
        <Eyebrow>How it works</Eyebrow>
        <h2>Your camera picture becomes points, in your browser.</h2>
        <p className="lede">Only those points are sent for recognition — never images or video.</p>
        <div className="card"><PipelineDiagram /></div>
        <p className="muted">Read the full breakdown on <a href="/how-it-works" onClick={link('/how-it-works')}>How it works</a>.</p>
      </section>

      <section className="section">
        <Eyebrow>Why SignSpeak</Eyebrow>
        <div className="feature-grid">
          <div className="feature">
            <ShieldIcon className="icon" />
            <h3 className="feature-title">Your video never leaves your device</h3>
            <p>Hand and body tracking runs in your browser. Only the positions of about 75 points per frame are sent for
              recognition. No image or video is sent or stored.</p>
          </div>
          <div className="feature">
            <HandIcon className="icon" />
            <h3 className="feature-title">Checked signs only</h3>
            <p>A person compares every sign with its official ISLRTC dictionary video before the model may learn it. Signs that
              need facial expressions are left out, because the tracker does not read faces.</p>
          </div>
          <div className="feature">
            <LanguageIcon className="icon" />
            <h3 className="feature-title">Four languages</h3>
            <p>Choose English, ಕನ್ನಡ, हिन्दी or தமிழ். Each recognised sign is shown in large text in the language you pick.</p>
          </div>
          <div className="feature">
            <SpeakerIcon className="icon" />
            <h3 className="feature-title">Spoken aloud</h3>
            <p>Recognised meanings can be read out, so a hearing person nearby can follow without reading the screen.</p>
          </div>
        </div>
      </section>

      <section className="section cta-final">
        <h2>Try it with your camera.</h2>
        <p className="lede">Use Chrome or Edge on a laptop or desktop. Sit back, raise your hand, and make a sign.</p>
        <div className="hero-actions">
          <Button variant="primary" size="large" href="/translate" onClick={link('/translate')}>Open Translate</Button>
          <Button size="large" href="/learn" onClick={link('/learn')}>Learn the signs first</Button>
        </div>
        <p className="muted small">SignSpeak is a hackathon prototype with a small vocabulary. It is not a replacement for an ISL interpreter.
          {' '}<a href="/about" onClick={link('/about')}>Read about its limits</a>.</p>
      </section>
    </div>
  );
}
