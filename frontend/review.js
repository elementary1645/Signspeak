(() => {
  const byId = id => document.getElementById(id);
  const cues = {
    static:'Can the full sign be represented as a static pose?',
    motion_required:'Is motion essential to the sign?',
    facial_cues_required:'Are facial cues essential?',
    body_cues_required:'Is body/face position essential?',
    relative_hand_position_required:'Is relative placement of both hands essential?',
    hands_v1_suitable:'Can per-hand wrist-centered landmarks represent this sign reliably?'
  };
  for (const [key, prompt] of Object.entries(cues)) {
    const label = document.createElement('label'); label.textContent = prompt+' ';
    const select = document.createElement('select'); select.id = 'cue-'+key; select.required = true;
    for (const [value,text] of [['','Select…'],['true','Yes'],['false','No']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    label.append(select); byId('review-cues').append(label);
  }
  const today = new Date();
  byId('review-date').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  let candidates = [];
  function showSource() {
    const candidate = candidates.find(e=>e.label === byId('review-label').value);
    if (!candidate) return;
    byId('lookup').href = candidate.lookup_url;
    byId('research').textContent = `${candidate.status} · ${candidate.research_status}. All hand/motion/cue properties await human inspection.`;
    byId('review-form').querySelectorAll('input[type=checkbox]').forEach(e=>{e.checked=false;});
    for (const id of ['reference-url','reference-id','reviewer','review-notes']) byId(id).value = '';
    for (const key of Object.keys(cues)) byId('cue-'+key).value = '';
    byId('review-hands').value = ''; byId('review-decision').value = 'exclude';
    byId('review-status').textContent = '';
  }
  fetch('/review-candidates').then(r=>{if (!r.ok) throw Error('Cannot load review queue');return r.json();}).then(entries=>{
    candidates = entries;
    for (const e of entries) {
      const option = document.createElement('option'); option.value = e.label;
      option.textContent = `${e.label} · review priority ${e.priority}`; byId('review-label').append(option);
    }
    showSource();
  }).catch(err=>{byId('review-status').textContent=err.message;});
  byId('review-label').onchange = showSource;
  byId('review-form').onsubmit = event => {
    event.preventDefault();
    if (!byId('review-form').reportValidity()) return;
    const review = {
      label:byId('review-label').value, verified:byId('review-decision').value==='approve',
      hand_count:Number(byId('review-hands').value), reference_id:byId('reference-id').value.trim(),
      reference_url:byId('reference-url').value.trim(), reviewer:byId('reviewer').value,
      reviewed_on:byId('review-date').value, human_inspected:byId('human-inspected').checked,
      official_source_confirmed:byId('official-confirmed').checked, notes:byId('review-notes').value.trim()
    };
    for (const key of Object.keys(cues)) review[key] = byId('cue-'+key).value==='true';
    if (!review.reference_url.startsWith('https://')) { byId('review-status').textContent = 'Use an exact HTTPS reference URL.'; return; }
    if (review.verified && (!review.static || !review.hands_v1_suitable || review.motion_required || review.facial_cues_required || review.body_cues_required || review.relative_hand_position_required)) {
      byId('review-status').textContent = 'These required cues are absent from hands-v1. Exclude this sign or revise the architecture before admission.'; return;
    }
    const blob = new Blob([JSON.stringify(review,null,2)+'\n'],{type:'application/json'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `${review.label}-review.json`; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    byId('review-status').textContent = `Review exported, not applied. Move it to your Codespace and run: python -m scripts.review_sign PATH/${review.label}-review.json --confirm-human-review`;
  };
})();
