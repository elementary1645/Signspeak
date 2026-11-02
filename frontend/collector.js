const $ = id => document.getElementById(id);
let stream, collecting = false, recording, count = 0, busy = false, timer;
const capture = document.createElement('canvas');
const edges = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
function stop() { collecting = false; $('start').disabled = !$('sign').options.length; }
function close() { stop(); clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); stream = null; $('status').textContent = 'Camera off'; }
$('close').onclick = close; $('stop').onclick = stop;
window.addEventListener('pagehide', close);
for (const id of ['sign', 'signer', 'session', 'consent']) $(id).onchange = stop;
$('start').onclick = () => {
  if (!stream || !$('consent').checked || !/^[A-Za-z0-9_-]{1,48}$/.test($('signer').value) || !/^[A-Za-z0-9_-]{1,48}$/.test($('session').value)) {
    $('status').textContent = 'Enable camera, consent, and enter valid pseudonymous IDs first.'; return;
  }
  recording = crypto.randomUUID(); collecting = true;
};
async function poll() {
  if (!stream) return;
  if (!busy && $('video').readyState >= 2) {
    busy = true;
    try {
      capture.width = 640; capture.height = Math.round(640 * $('video').videoHeight / $('video').videoWidth);
      capture.getContext('2d').drawImage($('video'), 0, 0, capture.width, capture.height);
      const response = await fetch('/frames', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        image:capture.toDataURL('image/jpeg', 0.75).split(',')[1], mirrored:false,
        collect:collecting, sign_class:$('sign').value, signer_id:$('signer').value,
        session_id:$('session').value, recording_id:recording || '', timestamp_ms:Date.now()
      })});
      const result = await response.json();
      if (!response.ok) throw Error(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail));
      const canvas = $('overlay'); canvas.width = capture.width; canvas.height = capture.height;
      const ctx = canvas.getContext('2d'); ctx.strokeStyle = '#6ce4c6'; ctx.fillStyle = '#ffda82';
      for (const hand of result.hands) {
        const pts = hand.landmarks.map(p => [p[0]*canvas.width, p[1]*canvas.height]);
        for (const [a,b] of edges) { ctx.beginPath(); ctx.moveTo(...pts[a]); ctx.lineTo(...pts[b]); ctx.stroke(); }
        for (const p of pts) { ctx.beginPath(); ctx.arc(...p,3,0,Math.PI*2); ctx.fill(); }
      }
      if (result.saved) $('count').textContent = ++count;
      $('status').textContent = `${result.status} · ${result.hands.length} hand(s) · ${collecting ? 'Collecting' : 'Preview only'}`;
    } catch (err) { stop(); $('status').textContent = err.message; }
    finally { busy = false; }
  }
  timer = setTimeout(poll, 1000 / Math.min(5, Math.max(0.5, Number($('rate').value) || 2)));
}
$('camera').onclick = async () => {
  if (stream) return;
  try { stream = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:false}); $('video').srcObject = stream; await $('video').play(); poll(); }
  catch (err) { close(); $('status').textContent = `Camera permission/access failed: ${err.message}`; }
};
fetch('/vocabulary').then(r=>r.json()).then(entries=>{
  for (const e of entries) { const option = document.createElement('option'); option.value=e.label; option.textContent=e.label; $('sign').append(option); }
  $('start').disabled = !entries.length;
  if (!entries.length) $('status').textContent = 'No reviewed static ISL signs yet. Landmark preview available; collection locked pending verification.';
}).catch(err=> { $('status').textContent = err.message; });
