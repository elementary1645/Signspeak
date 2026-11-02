// Browser behavior tests with DOM/camera substitutes; no claims of physical camera validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../collector.js'), 'utf8');
function harness(vocabulary = [{label:'TEST_FIXTURE',hand_count:1}]) {
  const elements = new Map(); let uuid = 0, stoppedTracks = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, options:[], value:({goal:'3',rate:'2',sign:'TEST_FIXTURE',signer:'p1',session:'s1'})[id] || '', checked:id==='consent',
      disabled:false, textContent:'', readyState:0, width:640, height:480,
      append(option){this.options.push(option);}, getContext(){return {clearRect(){}};},
      async play(){}
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document:{getElementById:element,createElement:()=>({value:'',textContent:''})},
    crypto:{randomUUID:()=>`uuid-${++uuid}`}, performance:{now:()=>1000},
    navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stoppedTracks++;}}]})}},
    window:{addEventListener(){}}, setTimeout:()=>1, clearTimeout(){},
    fetch:async url=>({ok:true,json:async()=>url==='/vocabulary'?vocabulary:{detector_ready:true,collection_enabled:true,recognition_ready:false,model_detail:'No model'}})
  });
  vm.runInContext(source,context);
  return {context,element,read:code=>vm.runInContext(code,context),stopped:()=>stoppedTracks};
}
const tick = () => new Promise(resolve=>setImmediate(resolve));
test('empty vocabulary keeps collection locked while camera preview can start', async()=>{
  const h = harness([]); await tick();
  await h.element('camera').onclick();
  assert.equal(h.element('start').disabled,true);
  assert.equal(h.read('!!stream'),true);
  h.element('close').onclick(); assert.equal(h.stopped(),1);
});
test('pause and resume preserve recording identity and count; mode change stops saving', async()=>{
  const h = harness(); await tick(); await h.element('camera').onclick();
  assert.equal(h.element('start').disabled,false);
  h.element('start').onclick(); const take = h.read('recording');
  h.read('takeCount=2'); h.element('pause').onclick();
  assert.equal(h.read('collecting'),false); assert.equal(h.read('paused'),true);
  h.element('resume').onclick();
  assert.equal(h.read('recording'),take); assert.equal(h.read('takeCount'),2);
  assert.equal(h.read('collecting'),true);
  h.element('recognize').checked=true; h.element('recognize').onchange();
  assert.equal(h.read('collecting'),false); assert.equal(h.element('start').disabled,true);
});
test('consent and pseudonyms required; goals reset for each new recording', async()=>{
  const h = harness(); await tick(); await h.element('camera').onclick();
  h.element('consent').checked=false; h.element('start').onclick();
  assert.equal(h.read('collecting'),false);
  h.element('consent').checked=true; h.element('signer').value='../bad'; h.element('start').onclick();
  assert.equal(h.read('collecting'),false);
  h.element('signer').value='signer1'; h.element('start').onclick();
  const first=h.read('recording'); h.read('takeCount=2'); h.element('stop').onclick(); h.element('start').onclick();
  assert.notEqual(h.read('recording'),first); assert.equal(h.read('takeCount'),0);
  assert.equal(h.element('progress').max,3);
});
