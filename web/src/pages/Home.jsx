import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api.js';
import DeviceNotice from '../lib/DeviceNotice.jsx';
import { HandIcon, LanguageIcon, ShieldIcon, SpeakerIcon } from '../lib/icons.jsx';

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
        <h1>Indian Sign Language to text and speech, in your browser.</h1>
        <p className="lede">SignSpeak watches your hands through the camera, recognises signs that have been checked against the
          official ISL dictionary, and shows and speaks their meaning in English, Kannada, Hindi or Tamil.</p>
        <div className="row">
          <a className="btn primary large" href="/translate" onClick={link('/translate')}>Start translating</a>
          <a className="btn large" href="/learn" onClick={link('/learn')}>Learn ISL</a>
        </div>
      </section>

      <section className="grid-3" aria-label="Status and privacy">
        <div className="card">
          <p className="stat" aria-describedby="supported-caption">{recognised ?? '…'}</p>
          <p id="supported-caption"><strong>signs supported right now</strong></p>
          {signs && (
            <p className="muted small">
              {signs.model_ready
                ? `The live model recognises ${recognised} of ${verified} verified sign${verified === 1 ? '' : 's'}.`
                : verified
                  ? `${verified} sign${verified === 1 ? ' is' : 's are'} verified; the recognition model has not been trained yet.`
                  : 'No sign has been verified against the official dictionary yet, so nothing is recognised.'}
            </p>
          )}
          {error && <p className="notice error small">Could not reach the server: {error}</p>}
        </div>
        <div className="card">
          <ShieldIcon className="icon" />
          <h2 className="h3">Your video never leaves your device</h2>
          <p>Hand and body tracking runs in your browser. Only the positions of about 75 points per frame are sent for
            recognition. No image or video is sent or stored.</p>
        </div>
        <div className="card">
          <HandIcon className="icon" />
          <h2 className="h3">Checked signs only</h2>
          <p>A person compares every sign with its official ISLRTC dictionary video before the model may learn it. Signs that
            need facial expressions are left out, because the tracker does not read faces.</p>
        </div>
      </section>

      <section className="grid-2">
        <div className="card feature">
          <LanguageIcon className="icon" />
          <h2 className="h3">Four languages</h2>
          <p>Choose English, ಕನ್ನಡ, हिन्दी or தமிழ். Each recognised sign is shown in large text in the language you pick.</p>
        </div>
        <div className="card feature">
          <SpeakerIcon className="icon" />
          <h2 className="h3">Spoken aloud</h2>
          <p>Recognised meanings can be read out, so a hearing person nearby can follow without reading the screen.</p>
        </div>
      </section>

      <p className="muted">SignSpeak is a hackathon prototype with a small vocabulary. It is not a replacement for an ISL interpreter.
        {' '}<a href="/about" onClick={link('/about')}>Read about its limits</a>.</p>
    </div>
  );
}
