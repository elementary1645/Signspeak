import { useLandmarks } from '../lib/useLandmarks.js';
import CameraView from '../lib/CameraView.jsx';

export default function Translate() {
  const cam = useLandmarks({});
  return (<><h1>Translate</h1><CameraView cam={cam} /></>);
}
