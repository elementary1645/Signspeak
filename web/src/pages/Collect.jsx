import { useLandmarks } from '../lib/useLandmarks.js';
import CameraView from '../lib/CameraView.jsx';

export default function Collect() {
  const cam = useLandmarks({});
  return (<><h1>Collect</h1><CameraView cam={cam} /></>);
}
