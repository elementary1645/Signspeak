const $ = id => document.getElementById(id);
let stream, collecting = false, paused = false, recording, count = 0, takeCount = 0;
let busy = false, timer, generation = 0, streamId = crypto.randomUUID();
let runStarted = 0, activeMs = 0, attempts = 0, validFrames = 0, service = {};
const capture = document.createElement('canvas');
const edges = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
function controls() {
  $('start').disabled = !stream || !$('sign').options.length || !service.collection_enabled || $('recognize').checked || collecting || paused;
  $('pause').disabled = !collecting; $('resume').disabled = !paused;
}
function stop() {
  if (collecting) activeMs += performance.now() - runStarted;
  collecting = false; paused = false; recording = undefined; controls();
}
function clearPrediction() {
  $('label').textContent = $('recognize').checked ? 'Waiting for camera frame' : 'Recognition off';
  for (const id of ['confidence','latency','event']) $(id).textContent = '';
}
function close() {
  stop(); ++generation; clearTimeout(timer);
  stream?.getTracks().forEach(t => t.stop()); stream = null; $('video').srcObject = null;
  $('overlay').getContext('2d').clearRect(0,0,$('overlay').width,$('overlay').height);
  streamId = crypto.randomUUID(); controls(); clearPrediction(); $('status').textContent = 'Camera off';
}
$('close').onclick = close; $('stop').onclick = () => { stop(); $('status').textContent = 'Collection stopped'; };
window.addEventListener('pagehide', close);
for (const id of ['sign','signer','session','consent','goal']) $(id).onchange = stop;
$('recognize').onchange = () => { stop(); streamId = crypto.randomUUID(); clearPrediction(); };
$('pause').onclick = () => {
  if (!collecting) return;
  activeMs += performance.now() - runStarted; collecting = false; paused = true; controls();
};
$('resume').onclick = () => { if (paused && stream) { paused = false; collecting = true; runStarted = performance.now(); controls(); } };
$('start').onclick = () => {
  if (!stream || !$('consent').checked || !/^[A-Za-z0-9_-]{1,48}$/.test($('signer').value) || !/^[A-Za-z0-9_-]{1,48}$/.test($('session').value)) {
    $('status').textContent = 'Enable camera, consent, and enter valid pseudonymous IDs first.'; return;
  }
  const goal = Number($('goal').value);
  if (!Number.isInteger(goal) || goal < 1 || goal > 500) { $('status').textContent = 'Goal must be 1–500 samples.'; return; }
  recording = crypto.randomUUID(); collecting = true; paused = false;
  takeCount = activeMs = attempts = validFrames = 0; runStarted = performance.now();
  $('take-count').textContent = '0'; $('progress').value = 0; $('progress').max = goal; controls();
};
function showPrediction(result, roundtrip) {
  const p = result.prediction;
  if (!p) { clearPrediction(); return; }
  const states = {no_hand:'No hand',unreliable:'Unreliable detection',unknown:'Unknown / rejected',model_unavailable:'No trained classifier',model_incompatible:'Model needs retraining',error:'Inference failed'};
  $('label').textContent = p.stable_label || (p.label ? `${p.label} · stabilizing` : states[p.state] || p.state);
  $('confidence').textContent = p.confidence == null ? (p.detail || '') : `Model score ${(p.confidence*100).toFixed(1)}%${p.smoothed_confidence == null ? '' : ` · smoothed ${(p.smoothed_confidence*100).toFixed(1)}%`} · ${p.confidence_kind} (not a guarantee of correctness)`;
  $('latency').textContent = `Server frame ${result.frame_latency_ms.toFixed(1)} ms · classifier ${p.classifier_latency_ms == null ? '—' : p.classifier_latency_ms.toFixed(1)+' ms'} · round trip ${roundtrip.toFixed(1)} ms`;
  if (p.event) $('event').textContent = `Stable event: ${p.event} · ${new Date().toLocaleTimeString()}`;
  if (!p.label) $('event').textContent = '';
}
async function poll(token) {
  if (!stream || token !== generation) return;
  if (!busy && $('video').readyState >= 2) {
    busy = true;
    const wasCollecting = collecting, sentRecording = recording, sentStream = streamId;
    const started = performance.now();
    try {
      capture.width = 640; capture.height = Math.round(640 * $('video').videoHeight / $('video').videoWidth);
      capture.getContext('2d').drawImage($('video'), 0, 0, capture.width, capture.height);
      const response = await fetch('/frames', {method:'POST', signal:AbortSignal.timeout(15000), headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        image:capture.toDataURL('image/jpeg', 0.75).split(',')[1], mirrored:false,
        collect:wasCollecting, sign_class:$('sign').value, signer_id:$('signer').value,
        session_id:$('session').value, recording_id:sentRecording || '', timestamp_ms:Date.now(),
        recognize:$('recognize').checked, stream_id:sentStream
      })});
      const result = await response.json();
      if (token !== generation) return;
      if (!response.ok) throw Error(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail));
      const canvas = $('overlay'); canvas.width = capture.width; canvas.height = capture.height;
      const ctx = canvas.getContext('2d'); ctx.strokeStyle = '#6ce4c6'; ctx.fillStyle = '#ffda82';
      for (const hand of result.hands) {
        const pts = hand.landmarks.map(p => [p[0]*canvas.width, p[1]*canvas.height]);
        for (const [a,b] of edges) { ctx.beginPath(); ctx.moveTo(...pts[a]); ctx.lineTo(...pts[b]); ctx.stroke(); }
        for (const p of pts) { ctx.beginPath(); ctx.arc(...p,3,0,Math.PI*2); ctx.fill(); }
      }
      if (result.saved) $('count').textContent = ++count;
      if (wasCollecting && sentRecording === recording) {
        attempts++; if (result.quality.valid_landmarks) validFrames++;
        if (result.saved) { $('take-count').textContent = ++takeCount; $('progress').value = takeCount; }
      }
      $('quality').textContent = `${result.quality.valid_landmarks ? 'Valid landmarks' : 'Missing / unreliable landmarks'} · ${result.hands.length} hand(s) · ${attempts ? `${validFrames}/${attempts} recording frames detected` : 'Preview'}`;
      const seconds = (activeMs + (collecting ? performance.now() - runStarted : 0)) / 1000;
      $('recording').textContent = `${collecting ? 'Recording' : paused ? 'Paused' : 'Idle'} · ${seconds.toFixed(1)} active seconds · ${attempts-takeCount} unsaved recording frames`;
      $('status').textContent = `${result.status} · ${collecting ? 'Collecting' : paused ? 'Paused' : 'Saving off'}`;
      if (sentStream === streamId) showPrediction(result, performance.now() - started);
      if (collecting && takeCount >= Number($('goal').value)) { stop(); $('status').textContent = 'Recording goal reached. Vary the pose naturally and start another take when ready.'; }
    } catch (err) { if (token === generation) { stop(); clearPrediction(); $('status').textContent = err.message; } }
    finally { busy = false; }
  }
  if (stream && token === generation) timer = setTimeout(() => poll(token), 1000 / Math.min(5, Math.max(0.5, Number($('rate').value) || 2)));
}
$('camera').onclick = async () => {
  if (stream) return;
  const token = ++generation;
  try {
    const candidate = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:false});
    if (token !== generation) { candidate.getTracks().forEach(t=>t.stop()); return; }
    stream = candidate; $('video').srcObject = stream; await $('video').play(); controls(); poll(token);
  } catch (err) { close(); $('status').textContent = `Camera permission/access failed: ${err.message}`; }
};
$('audit').onclick = async () => {
  try {
    const response = await fetch('/dataset/quality'); const result = await response.json();
    $('audit-result').textContent = JSON.stringify(response.ok ? result : result.detail, null, 2);
  } catch (err) { $('audit-result').textContent = err.message; }
};
Promise.all([fetch('/vocabulary').then(async r=>{ if (!r.ok) throw Error('Vocabulary registry invalid'); return r.json(); }),fetch('/health').then(r=>r.json())]).then(([entries,health])=>{
  service = health;
  for (const e of entries) { const option = document.createElement('option'); option.value=e.label; option.textContent=`${e.label} · ${e.hand_count} hand(s)`; $('sign').append(option); }
  controls();
  $('health').textContent = `Hand detector: ${health.detector_ready ? 'ready' : health.detail} · Feature saving: ${health.collection_enabled ? 'enabled with consent' : 'disabled on server'} · Classifier: ${health.recognition_ready ? 'loaded' : health.model_detail}`;
  if (!entries.length) $('status').textContent = 'No human-verified static signs. Landmark preview available; collection locked pending review.';
}).catch(err=> { $('status').textContent = err.message; });
