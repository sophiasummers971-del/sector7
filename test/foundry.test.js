import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { runLabel, workerState, routeFor, inventory, preferences, startingPoints, localWorkflowTrace } from '../public/foundry-state.js';
import { runScout, loadScoutRun } from '../scout.js';
import { createScoutService } from '../scout-service.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sample = { operationKey: 'foundry-test', terms: ['local'], repositories: [{ id: 'fictional/local', readme: 'Local sample' }] };
const accepted = { sender: 'worker-1', kind: 'accepted', jobId: 'job-1' };
async function temporary(fn) { const dir = await mkdtemp(path.join(root, '.test-data-foundry-')); try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }

test('terminal cancellation/failure cannot leave an accepted worker falsely running', () => {
  for (const status of ['interrupted', 'cancelled', 'failed', 'timed_out', 'rejected']) {
    assert.equal(workerState({ status }, [accepted], 'worker-1'), status);
  }
  assert.equal(workerState({ status: 'completed' }, [accepted], 'worker-1'), 'unknown');
  assert.equal(workerState({ status: 'running' }, [accepted], 'worker-1', { confirmed: false }), 'unknown');
  assert.equal(workerState({ status: 'interrupted' }, [accepted], 'worker-1', { replaying: true }), 'running');
  assert.equal(runLabel({ status: 'running' }, { confirmed: false }), 'UNKNOWN');
  assert.equal(runLabel({ status: 'completed' }, { replaying: true }), 'REPLAY · NOT LIVE');
});
test('inventory does not claim unavailable data or successful verification', () => {
  assert.equal(inventory(null), null);
  assert.deepEqual(inventory([{status:'completed'}, {status:'WAITING_APPROVAL'}, {status:'rejected'}, {status:'running'}]), {runs:4,completed:1,waiting:1,failed:1});
  assert.deepEqual(preferences({ theme: 'untrusted', motion: 'random', lowPower: 'true' }), {theme:'industrial',motion:'subtle',lowPower:false});
  assert.equal(routeFor({ sender:'worker-2',kind:'completed' }, []), 'route-return-right');
});
test('same-key field order retries preserve old persisted fingerprints and never overwrite invalid records', async () => temporary(async dir => {
  const first = await runScout(sample, {dataDir:dir});
  const reordered = { repositories: [{readme:'Local sample',id:'fictional/local'}], terms:['local'], operationKey:sample.operationKey };
  assert.equal((await runScout(reordered, {dataDir:dir})).duplicate, true);
  // Simulate a pre-canonicalisation valid record; preserve its source hashes.
  const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const legacy = structuredClone(first.run);
  legacy.fingerprint = hash(reordered); legacy.jobs[0].inputHash = hash(reordered.repositories[0]);
  legacy.events.forEach(e => {e.inputHash=legacy.jobs[0].inputHash;});
  const inputFile = path.join(first.directory,'input.json'), runFile=path.join(first.directory,'run.json');
  await writeFile(inputFile,JSON.stringify(reordered)); await writeFile(runFile,JSON.stringify(legacy));
  assert.deepEqual((await runScout(sample,{dataDir:dir})).run,legacy);
  assert.deepEqual(await loadScoutRun(dir,sample.operationKey),legacy);
  for (const value of ['null','false','0','[]']) {
    await writeFile(runFile,value);
    await assert.rejects(runScout(sample,{dataDir:dir}));
    assert.equal(await readFile(runFile,'utf8'),value);
    assert.equal(await readFile(inputFile,'utf8'),JSON.stringify(reordered));
  }
}));
test('immediate same-key changed-payload read cannot publish stale terminal success', async () => temporary(async dir => {
  const service=createScoutService(dir,{repositories:sample.repositories}); await service.ready;
  await service.submit({operationKey:sample.operationKey,terms:['local']}); await service.drain();
  await service.submit({operationKey:sample.operationKey,terms:['different']});
  await assert.rejects(service.get(sample.operationKey),error=>error.status===409);
  await service.drain();
}));

// Minimal DOM harness exercises the shipped controller, storage and fetch boundary.
// It is not a layout engine and is never reported as rendered browser evidence.
class Element {
  constructor(){this.textContent='';this.dataset={};this.children=[];this.disabled=false;this.checked=true;this.style={};this.clientWidth=800;this.scrollLeft=0;this.scrollTop=0;this.classList={add(){},remove(){},toggle(){}};}
  append(...n){this.children.push(...n);} replaceChildren(...n){this.children=n;}
  addEventListener(){} getBoundingClientRect(){return {};} showModal(){this.open=true;} close(){this.open=false;}
  scrollTo(){} setPointerCapture(){}
}
async function controller({saved=null,offline=false,standalone=false}={}) {
  const elements=new Map(), get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const terms=['workflow','local','queue'].map(value=>Object.assign(new Element(),{value}));
  const storage=new Map(saved?[['sector7-command-request',JSON.stringify(saved)]]:[]);
  const calls=[]; const timers=[];
  const record=JSON.parse(await readFile(path.join(root,'docs/command-example-run.json')));
  const context=vm.createContext({console,Date,Set,Map,JSON,URLSearchParams,AbortSignal,structuredClone,
    crypto:{randomUUID:()=> 'fresh-key'},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:()=> 'test-owner-key'},
    document:{documentElement:new Element(),getElementById:get,createElement:()=>new Element(),querySelector:selector=>get(selector),querySelectorAll:selector=>selector.includes('input')?terms:[],addEventListener(){}},
    window:{addEventListener(){}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},confirm:()=>true,
    fetch:async(url,options={})=>{calls.push({url,options});if(offline)throw Error('offline');return {ok:true,status:200,json:async()=> url==='/api/scout/control'?{paused:false,open:false}:url==='/api/tasks'?{tasks:[]}:url.startsWith('/api/scout/')?{run:record,active:false}:{} };}
  });
  const model=(await readFile(path.join(root,'public/foundry-state.js'),'utf8')).replaceAll('export ','');
  const js=(await readFile(path.join(root,'public/command.js'),'utf8')).replace(/^import .*;\n/gm,'');
  const code = standalone ? (await readFile(path.join(root,'docs/sector7-command-preview.html'),'utf8')).match(/<script type="module">([\s\S]*)<\/script>/)[1] : model+'\n'+js;
  vm.runInContext(code,context);
  for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  return {context,get,calls,timers,storage,record,setOffline:value=>{offline=value;}};
}
test('offline reload keeps unresolved operation key and fails closed even if launch is manipulated',async()=>{
  const saved={operationKey:'retained-key',terms:['local']}; const c=await controller({saved,offline:true});
  assert.equal(c.get('launch').disabled,true); assert.match(c.get('launch').textContent,/Retry same request/);
  c.get('launch').disabled=false; await c.get('launch').onclick();
  assert.deepEqual(JSON.parse(c.storage.get('sector7-command-request')),saved);
  assert.equal(c.calls.some(c=>c.options.method==='POST'),false);
  assert.equal(c.get('run-state').textContent,'UNKNOWN');
});
test('recorded replay is read only, terminal outcome remains separate, event inspector contains actual receipt',async()=>{
  const c=await controller({saved:{operationKey:'retained-key',terms:['local']}});
  assert.match(c.get('run-state').textContent,/COMPLETED/);
  const before=c.calls.length;
  c.get('replay').onclick(); assert.match(c.get('run-state').textContent,/NOT LIVE/);
  assert.equal(c.get('launch').disabled,true);
  c.get('events').children[0].children[0].onclick();
  assert.equal(JSON.parse(c.get('inspector-data').textContent).sequence,1);
  c.get('replay').onclick();
  assert.equal(c.calls.length,before,'Replay and inspection make no API requests');
  assert.match(c.get('run-state').textContent,/COMPLETED/);
});

test('standalone recorded preview denies all API activity even when disabled controls are enabled manually',async()=>{
  const c=await controller({standalone:true});
  assert.equal(c.get('launch').disabled,true);
  assert.equal(c.get('connection-text').textContent,'Recorded preview');
  c.get('launch').disabled=false; await c.get('launch').onclick();
  c.get('pause').disabled=false; await c.get('pause').onclick();
  c.get('replay').onclick(); c.get('replay').onclick();
  assert.equal(c.calls.length,0);
  assert.match(c.get('run-state').textContent,/COMPLETED/);
});

test('all shipped styles reject acid or lime tokens and fluorescent green colours',async()=>{
  for (const file of ['command.css','styles.css','tokens.css']) {
    const css=await readFile(path.join(root,'public',file),'utf8');
    assert.doesNotMatch(css,/--acid|lime|chartreuse|greenyellow/i);
    for(const match of css.matchAll(/#([a-f0-9]{6})(?:[a-f0-9]{2})?\b/gi)) {
      const hex=match[1],r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
      assert.equal(g>=150 && g>r*1.2 && g>b*1.2,false,file+': rejected green '+hex);
    }
  }
});

test('starting suggestions use confirmed records and suppress stale work while disconnected',()=>{
  const workflow={definition:{nodes:[{id:'start'},{id:'input'},{id:'result'}]}};
  const tasks=[{status:'WAITING_APPROVAL'},{status:'interrupted'}];
  const points=startingPoints({connected:true,workflow,tasks,unresolved:true});
  assert.equal(points.length,3);
  assert.equal(points[0].action,'refresh');
  assert.match(points[1].title,/1 waiting approval/);
  assert.equal(points[1].href,'/studio#waiting-section');
  assert.match(points[2].detail,/3 saved nodes/);
  assert.deepEqual(startingPoints({connected:false,workflow,tasks}),[{title:'Connect to your saved work',detail:'Refresh the owner connection to see confirmed suggestions.',action:'refresh'}]);
  assert.equal(startingPoints({preview:true,connected:true,workflow,tasks})[0].action,'inspect');
  assert.equal(startingPoints({connected:true,tasks:[]}).some(point=>/waiting|unfinished/.test(point.title)),false);
});
test('typed idea stays literal and local; choosing a next step cannot submit or approve work',async()=>{
  const c=await controller({saved:{operationKey:'retained-key',terms:['local']}});
  const before=c.calls.length, saved=c.storage.get('sector7-command-request');
  const idea='<script>approveEverything()</script> Launch agents and publish my release';
  c.get('idea-input').value=idea;
  let prevented=false;
  c.get('idea-form').onsubmit({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(c.get('idea-response').hidden,false);
  assert.equal(c.get('idea-heading').textContent,'Your idea: '+idea);
  assert.match(c.get('idea-copy').textContent,/cannot turn free text into a plan yet/);
  assert.equal(c.calls.length,before);
  assert.equal(c.storage.get('sector7-command-request'),saved);
  assert.equal([...c.storage.values()].some(value=>value.includes(idea)),false,'Idea is not persisted alongside workflow or request data');
  assert.equal(c.get('starting-points').children[0].href,'/studio#text-preset');
  c.get('idea-input').value=''; c.get('idea-form').onsubmit({preventDefault(){}});
  assert.match(c.get('idea-heading').textContent,/Choose a suggestion/);
});

test('actual workflow trace is read-only, bounded, and never invents agent activity', () => {
  assert.equal(localWorkflowTrace(null), null);
  assert.equal(localWorkflowTrace([{id:'not-a-workflow',status:'completed'}]), null);
  const recorded = {
    id:'run-real',status:'WAITING_APPROVAL',
    workflowSnapshot:{definition:{nodes:[{id:'start',type:'start'},{id:'transform',type:'text.transform'},{id:'approval',type:'approval'}]}},
    nodeResults:[
      {id:'start',status:'completed',at:'2026-10-30T10:00:00Z',result:{secret:'never disclose'}},
      {id:'transform',status:'completed',result:{text:'private text'}},
      {id:'approval',status:'WAITING_APPROVAL',inputs:{text:'private text'}}
    ]
  };
  const actual = localWorkflowTrace([recorded]);
  assert.equal(actual.status,'WAITING_APPROVAL');
  assert.equal(actual.waiting,true);
  assert.deepEqual(actual.nodes.map(n=>n.status),['completed','completed','WAITING_APPROVAL']);
  assert.equal(JSON.stringify(actual).includes('private text'),false);
  assert.equal(JSON.stringify(actual).includes('never disclose'),false);
  recorded.nodeResults.push({id:'unknown-step',status:'running'});
  assert.equal(localWorkflowTrace([recorded]).nodes.length,3);
});

test('factory prioritises approval requiring attention and gives safe next actions', () => {
  const make = (id,status) => ({ id, status, workflowSnapshot: { definition: {nodes:[{id:'start',type:'start'}]} }, nodeResults:[{id:'start',status:'completed'}] });
  const done = make('newer','completed');
  const approval = make('older','WAITING_APPROVAL');
  const selected = localWorkflowTrace([done,approval]);
  assert.equal(selected.id,'older');
  assert.equal(selected.waiting,true);
  assert.match(selected.guidance,/inspect the exact saved pause/);
  assert.match(localWorkflowTrace([make('a','interrupted')]).guidance,/no automatic retry/);
  assert.match(localWorkflowTrace([make('b','running')]).guidance,/Outcome not confirmed/);
  assert.match(localWorkflowTrace([done]).guidance,/Recorded execution finished/);
});

test('recorded workflow highlight is static and does not fabricate live animation', async () => {
  const command = await readFile(path.join(root,'public/command.js'),'utf8');
  const css = await readFile(path.join(root,'public/command.css'),'utf8');
  assert.match(command,/recent-transition/);
  assert.match(css,/LAST RECORDED/);
  const section = css.slice(css.indexOf('Evidence trail: last confirmed'));
  assert.doesNotMatch(section,/@keyframes|animation\s*:/);
  assert.match(command,/Saved history only; not a live swarm/);
});

test('local signal field switches sources without submitting or approving work', async () => {
  const c = await controller();
  const before = c.calls.length;
  c.get('view-local').onclick();
  assert.equal(c.get('local-signal-field').hidden,false);
  assert.equal(c.get('scout-signal-field').hidden,true);
  assert.equal(c.get('view-local').ariaPressed,'true');
  assert.equal(c.calls.length,before);
  c.get('view-scout').onclick();
  assert.equal(c.get('local-signal-field').hidden,true);
  assert.equal(c.get('scout-signal-field').hidden,false);
  assert.equal(c.calls.length,before);
});
test('signal-field implementation is read-only and does not animate invented events',async()=>{
  const css=await readFile(path.join(root,'public/command.css'),'utf8');
  const code=await readFile(path.join(root,'public/command.js'),'utf8');
  const region=css.slice(css.lastIndexOf('Two distinct evidence sources:'));
  assert.match(region,/local-signal-field/);
  assert.doesNotMatch(region,/@keyframes|animation\s*:/);
  assert.match(code,/Historical saved step only/);
  assert.match(code,/connected \? localWorkflowTrace/);
});
