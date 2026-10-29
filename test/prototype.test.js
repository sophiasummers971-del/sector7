import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('local task execution, validation, idempotency and restart persistence', async t => {
  const dir = await mkdtemp(path.join(root, '.test-data-'));
  let child;
  let base;
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: root,
      env: { ...process.env, PORT: '0', SECTOR7_HOST: '127.0.0.1', SECTOR7_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Server startup timed out')), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error('Server exited: '+code)); });
      child.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
  }
  async function post(body, type='application/json') {
    const response = await fetch(base+'/api/tasks', { method:'POST', headers:{'Content-Type':type}, body });
    return { status:response.status, body:await response.json() };
  }
  const payload = JSON.stringify({operationKey:'check-1',action:'system.ping'});
  try {
    await start();
    const initialInstance=await (await fetch(base+'/api/status')).json();
    await t.test('server instance is stable within one process and static assets are explicit',async()=>{
      assert.deepEqual(await (await fetch(base+'/api/status')).json(),initialInstance);
      assert.match(initialInstance.instanceId,/^[a-f0-9-]{36}$/);
      for(const asset of ['/app.js','/evidence.js','/styles.css'])assert.equal((await fetch(base+asset)).status,200);
      assert.equal((await fetch(base+'/private-file')).status,404);
    });
    const first = await post(payload);
    await t.test('successful execution and actual history', () => {
      assert.equal(first.status,201); assert.equal(first.body.task.result.message,'pong');
      assert.deepEqual(first.body.task.history.map(x=>x.status),['created','running','completed']);
    });
    await t.test('duplicate returns identical original task', async () => {
      const duplicate = await post(payload); assert.equal(duplicate.status,200);
      assert.equal(duplicate.body.duplicate,true); assert.deepEqual(duplicate.body.task,first.body.task);
    });
    await t.test('concurrent duplicate submissions create only one task', async () => {
      const data=JSON.stringify({operationKey:'parallel-1',action:'system.ping'});
      const results=await Promise.all([post(data),post(data)]);
      assert.deepEqual(results.map(x=>x.status).sort(),[200,201]);
      assert.equal(results[0].body.task.id,results[1].body.task.id);
    });
    await t.test('different payload with original key conflicts', async () => {
      assert.equal((await post(JSON.stringify({operationKey:'check-1',action:'system.other'}))).status,409);
    });
    await t.test('malformed and invalid requests rejected', async () => {
      for (const body of ['{','null','[]','{}',JSON.stringify({operationKey:'bad key',action:'system.ping'}),JSON.stringify({operationKey:'new',action:'system.other'}),JSON.stringify({operationKey:'new',action:'system.ping',extra:true})]) {
        assert.equal((await post(body)).status,400);
      }
      assert.equal((await post(payload,'text/plain')).status,415);
      assert.equal((await post('x'.repeat(4097))).status,413);
    });
    await t.test('page served and cross-origin submission rejected', async () => {
      const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/Sector 7/);
      const cross=await fetch(base+'/api/tasks',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body:payload});assert.equal(cross.status,403);
    });
    await t.test('same-origin browser submission accepted', async () => {
      const response=await fetch(base+'/api/tasks',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:payload});
      assert.equal(response.status,200);assert.equal((await response.json()).task.id,first.body.task.id);
    });
    const put = async definition => {
      const response=await fetch(base+'/api/workflow',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(definition)});
      return {status:response.status,body:await response.json()};
    };
    const originalWorkflow=await (await fetch(base+'/api/workflow')).json();
    const edited={nodes:[{id:'result',type:'result'},{id:'second',type:'system.ping'},{id:'start',type:'start'},{id:'ping',type:'system.ping'}],
      edges:[{from:'ping',to:'result'},{from:'start',to:'second'},{from:'second',to:'ping'}]};
    let saved,workflowTask,revised;
    await t.test('save and reload an edited graph',async()=>{
      const result=await put(edited);assert.equal(result.status,200);saved=result.body;
      assert.notEqual(saved.revision,originalWorkflow.revision);
      assert.deepEqual(await (await fetch(base+'/api/workflow')).json(),saved);
    });
    await t.test('invalid graphs rejected clearly without changing saved definition',async()=>{
      const clone=()=>structuredClone(edited);
      const cases=[];
      let bad=clone();bad.edges.push({from:'result',to:'start'});cases.push([bad,/Cycles/]);
      bad=clone();bad.nodes[1].type='shell.exec';cases.push([bad,/Unsupported/]);
      bad=clone();bad.edges.pop();cases.push([bad,/Disconnected/]);
      bad=clone();bad.edges[0].to='missing';cases.push([bad,/endpoints/]);
      bad=clone();bad.edges.push({from:'start',to:'ping'});cases.push([bad,/branching/]);
      bad=clone();bad.edges.push({...bad.edges[0]});cases.push([bad,/Duplicate connections/]);
      bad=clone();bad.edges=[{from:'result',to:'ping'},{from:'ping',to:'second'},{from:'second',to:'start'}];cases.push([bad,/Invalid connections/]);
      bad=clone();bad.nodes.push({id:'otherStart',type:'start'});cases.push([bad,/Exactly one/]);
      bad=clone();bad.nodes[1].id='ping';cases.push([bad,/Duplicate node/]);
      bad=clone();bad.nodes[1].command='anything';cases.push([bad,/Each node/]);
      bad=clone();bad.nodes[1].type={toString:'not callable'};cases.push([bad,/Unsupported/]);
      bad=clone();bad.edges[0]={from:'ping',to:'ping'};cases.push([bad,/Cycles/]);
      bad=clone();bad.edges[0].command='anything';cases.push([bad,/endpoints/]);
      bad=clone();bad.nodes.push(...Array.from({length:9},(_,i)=>({id:'excess'+i,type:'system.ping'})));cases.push([bad,/3–12/]);
      cases.push([null,/Workflow/]);
      for(const [definition,message]of cases){const result=await put(definition);assert.equal(result.status,400);assert.match(result.body.error,message)}
      assert.deepEqual(await (await fetch(base+'/api/workflow')).json(),saved);
      const denied=await fetch(base+'/api/workflow',{method:'PUT',headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body:JSON.stringify(edited)});
      assert.equal(denied.status,403);
    });
    const workflowInput=()=>({operationKey:'workflow-1',action:'workflow.run',workflowRevision:saved.revision});
    await t.test('edited graph executes by edges rather than node-array order or fixed sequence',async()=>{
      const result=await post(JSON.stringify(workflowInput()));assert.equal(result.status,201);workflowTask=result.body.task;
      assert.deepEqual(workflowTask.nodeResults.map(node=>node.id),['start','second','ping','result']);
      assert.equal(workflowTask.nodeResults[2].inputs.nodeId,'second');
      assert.deepEqual(workflowTask.nodeResults[3].result,workflowTask.nodeResults[2].result);
      assert.deepEqual(workflowTask.workflowSnapshot,saved);
    });
    await t.test('snapshot and duplicate semantics survive subsequent edits',async()=>{
      const changed=structuredClone(edited);changed.edges=[{from:'start',to:'ping'},{from:'ping',to:'second'},{from:'second',to:'result'}];
      const result=await put(changed);assert.equal(result.status,200);revised=result.body;
      const duplicate=await post(JSON.stringify(workflowInput()));assert.equal(duplicate.status,200);assert.deepEqual(duplicate.body.task,workflowTask);
      assert.equal((await post(JSON.stringify({...workflowInput(),workflowRevision:revised.revision}))).status,409);
      assert.equal((await post(JSON.stringify({...workflowInput(),operationKey:'stale-new-key'}))).status,409);
      const next=await post(JSON.stringify({operationKey:'workflow-2',action:'workflow.run',workflowRevision:revised.revision}));
      assert.equal(next.status,201);assert.deepEqual(next.body.task.nodeResults.map(node=>node.id),['start','ping','second','result']);
      assert.equal(next.body.task.result.nodeId,'second');
      assert.deepEqual(workflowTask.workflowSnapshot,saved);
    });
    await stop(); await start();
    await t.test('records and operation-key semantics survive restart', async () => {
      assert.notEqual((await (await fetch(base+'/api/status')).json()).instanceId,initialInstance.instanceId);
      const duplicate=await post(payload); assert.equal(duplicate.status,200);
      assert.deepEqual(duplicate.body.task,first.body.task);
      const listing=await (await fetch(base+'/api/tasks')).json();assert.equal(listing.tasks.length,4);
      assert.equal((await post(JSON.stringify({operationKey:'check-1',action:'system.other'}))).status,409);
      assert.deepEqual(await (await fetch(base+'/api/workflow')).json(),revised);
      const old=await post(JSON.stringify(workflowInput()));assert.equal(old.status,200);assert.deepEqual(old.body.task,workflowTask);
    });
    const gated={nodes:[{id:'s',type:'start'},{id:'before',type:'system.ping'},{id:'gate',type:'approval'},{id:'after',type:'system.ping'},{id:'r',type:'result'}],
      edges:[{from:'s',to:'before'},{from:'before',to:'gate'},{from:'gate',to:'after'},{from:'after',to:'r'}]};
    let gatedSaved,waiting,waitingInput;
    const decision=async(task,choice,approvalId=task.waitingApproval?.approvalId)=>{
      const response=await fetch(base+'/api/tasks/'+task.id+'/approval',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approvalId,decision:choice})});
      return {status:response.status,body:await response.json()};
    };
    await t.test('Approval persists a waiting run without executing downstream ping',async()=>{
      const saved=await put(gated);assert.equal(saved.status,200);gatedSaved=saved.body;
      waitingInput={operationKey:'approval-1',action:'workflow.run',workflowRevision:gatedSaved.revision};
      const run=await post(JSON.stringify(waitingInput));assert.equal(run.status,201);waiting=run.body.task;
      assert.equal(waiting.status,'WAITING_APPROVAL');assert.equal(waiting.result,null);
      assert.deepEqual(waiting.nodeResults.map(node=>[node.id,node.status]),[['s','completed'],['before','completed'],['gate','WAITING_APPROVAL']]);
      assert.deepEqual(waiting.waitingApproval.nextAction,{id:'after',type:'system.ping'});
      const disk=JSON.parse(await readFile(path.join(dir,'tasks.json'),'utf8')).find(task=>task.id===waiting.id);
      assert.deepEqual(disk,waiting);
    });
    await t.test('waiting snapshot survives editing, duplicate submission and restart without approval',async()=>{
      assert.equal((await put(edited)).status,200);
      const duplicate=await post(JSON.stringify(waitingInput));assert.equal(duplicate.status,200);assert.deepEqual(duplicate.body.task,waiting);
      await stop();await start();
      const persisted=(await (await fetch(base+'/api/tasks')).json()).tasks.find(task=>task.id===waiting.id);
      assert.deepEqual(persisted,waiting);assert.deepEqual(persisted.workflowSnapshot,gatedSaved);
    });
    await t.test('approval request validation and cross-origin rejection leave run waiting',async()=>{
      assert.equal((await decision(waiting,'unsupported')).status,400);
      assert.equal((await decision(waiting,'approve','00000000-0000-0000-0000-000000000000')).status,409);
      const denied=await fetch(base+'/api/tasks/'+waiting.id+'/approval',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body:JSON.stringify({approvalId:waiting.waitingApproval.approvalId,decision:'approve'})});
      assert.equal(denied.status,403);
      const unknown=await decision({...waiting,id:'00000000-0000-0000-0000-000000000000'},'approve');assert.equal(unknown.status,404);
      const unchanged=await post(JSON.stringify(waitingInput));assert.deepEqual(unchanged.body.task,waiting);
    });
    let approved;
    await t.test('concurrent duplicate approvals continue downstream exactly once in this process',async()=>{
      const responses=await Promise.all([decision(waiting,'approve'),decision(waiting,'approve')]);
      assert.ok(responses.every(response=>response.status===200));
      assert.deepEqual(responses.map(response=>response.body.duplicate).sort(),[false,true]);approved=responses[0].body.task;
      assert.deepEqual(responses[1].body.task,approved);assert.equal(approved.status,'completed');
      assert.deepEqual(approved.nodeResults.map(node=>node.id),['s','before','gate','after','r']);
      assert.equal(approved.approvals.length,1);assert.equal(approved.waitingApproval,null);
      assert.deepEqual(approved.workflowSnapshot,gatedSaved);
      assert.equal((await decision(waiting,'reject')).status,409);
    });
    await t.test('Reject and Cancel persist terminal states and never execute downstream nodes',async()=>{
      assert.equal((await put(gated)).status,200);
      for(const [choice,status]of [['reject','rejected'],['cancel','cancelled']]){
        const input={operationKey:'approval-'+choice,action:'workflow.run',workflowRevision:gatedSaved.revision};
        const run=await post(JSON.stringify(input));const paused=run.body.task;
        const response=await decision(paused,choice);assert.equal(response.status,200);assert.equal(response.body.task.status,status);
        assert.ok(!response.body.task.nodeResults.some(node=>node.id==='after'||node.id==='r'));
        assert.equal(response.body.task.nodeResults.at(-1).status,status);
        const duplicate=await decision(paused,choice);assert.equal(duplicate.body.duplicate,true);assert.deepEqual(duplicate.body.task,response.body.task);
        assert.equal((await decision(paused,'approve')).status,409);
        await stop();await start();
        assert.deepEqual((await post(JSON.stringify(input))).body.task,response.body.task);
      }
    });
    await t.test('a replay for the first Approval never releases a later Approval',async()=>{
      const chain=structuredClone(gated);chain.nodes.push({id:'gate2',type:'approval'});
      chain.edges=chain.edges.filter(edge=>edge.from!=='after');chain.edges.push({from:'after',to:'gate2'},{from:'gate2',to:'r'});
      const saved=(await put(chain)).body;
      const first=(await post(JSON.stringify({operationKey:'two-gates',action:'workflow.run',workflowRevision:saved.revision}))).body.task;
      const second=(await decision(first,'approve')).body.task;assert.equal(second.status,'WAITING_APPROVAL');
      assert.equal(second.waitingApproval.nodeId,'gate2');assert.notEqual(second.waitingApproval.approvalId,first.waitingApproval.approvalId);
      const old=await decision(first,'approve');assert.equal(old.body.duplicate,true);assert.deepEqual(old.body.task,second);
      assert.ok(!old.body.task.nodeResults.some(node=>node.id==='r'));
      const complete=await decision(second,'approve');assert.equal(complete.body.task.status,'completed');assert.equal(complete.body.task.approvals.length,2);
      await stop();await start();
      assert.deepEqual((await decision(waiting,'approve')).body.task,approved);
    });
    await t.test('text settings, actual data passing, approval snapshot, retry and restart',async()=>{
      for(const [operation,text,expected] of [['uppercase','  Hello <img src=x> sharp \u00df  ','  HELLO <IMG SRC=X> SHARP SS  '],['lowercase',' MiXeD ',' mixed '],['trim',' \t local message \n','local message']]){
        const definition={nodes:[{id:'s',type:'start'},{id:'input',type:'text.input',settings:{text}},{id:'transform',type:'text.transform',settings:{operation}},{id:'gate',type:'approval'},{id:'r',type:'result'}],edges:[{from:'s',to:'input'},{from:'input',to:'transform'},{from:'transform',to:'gate'},{from:'gate',to:'r'}]};
        const response=await put(definition);assert.equal(response.status,200);const snapshot=response.body;
        assert.deepEqual((await (await fetch(base+'/api/workflow')).json()),snapshot);
        const input={operationKey:'text-'+operation,action:'workflow.run',workflowRevision:snapshot.revision};
        const paused=(await post(JSON.stringify(input))).body.task;assert.equal(paused.status,'WAITING_APPROVAL');
        assert.equal(paused.nodeResults.at(-1).inputs.text,expected);assert.equal(paused.nodeResults[2].inputs.text,text);
        assert.ok(!paused.nodeResults.some(n=>n.id==='r'));
        definition.nodes.find(n=>n.id==='input').settings.text='later edit';assert.equal((await put(definition)).status,200);
        await stop();await start();assert.deepEqual((await post(JSON.stringify(input))).body.task,paused);
        const complete=(await decision(paused,'approve')).body.task;assert.equal(complete.status,'completed');assert.deepEqual(complete.result,{text:expected});
        assert.deepEqual(complete.workflowSnapshot,snapshot);assert.deepEqual(complete.nodeResults.at(-1).inputs,{text:expected});
        assert.deepEqual((await decision(paused,'approve')).body.task,complete);
        assert.deepEqual((await post(JSON.stringify(input))).body.task,complete);
        assert.equal((await post(JSON.stringify({...input,workflowRevision:(await put(definition)).body.revision}))).status,409);
      }
    });
    await t.test('text rejection and cancellation never produce a Result',async()=>{
      const definition={nodes:[{id:'s',type:'start'},{id:'i',type:'text.input',settings:{text:' private local text '}},{id:'t',type:'text.transform',settings:{operation:'trim'}},{id:'a',type:'approval'},{id:'r',type:'result'}],edges:[{from:'s',to:'i'},{from:'i',to:'t'},{from:'t',to:'a'},{from:'a',to:'r'}]};
      const snapshot=(await put(definition)).body;
      for(const choice of ['reject','cancel']){
        const input={operationKey:'text-stop-'+choice,action:'workflow.run',workflowRevision:snapshot.revision};
        const paused=(await post(JSON.stringify(input))).body.task;
        const stopped=(await decision(paused,choice)).body.task;assert.equal(stopped.result,null);assert.ok(!stopped.nodeResults.some(n=>n.id==='r'));
        assert.equal((await decision(paused,'approve')).status,409);assert.deepEqual((await post(JSON.stringify(input))).body.task,stopped);
      }
      for(const settings of [{text:'x'.repeat(501)},{text:42},{text:'ok',extra:true}]){
        const bad=structuredClone(definition);bad.nodes[1].settings=settings;assert.equal((await put(bad)).status,400);
      }
      const bad=structuredClone(definition);bad.nodes[2].settings.operation='eval';assert.equal((await put(bad)).status,400);
      const missing=structuredClone(definition);missing.nodes[1]={id:'i',type:'system.ping'};assert.equal((await put(missing)).status,400);
      const empty=structuredClone(definition);empty.nodes[1].settings.text='';assert.equal((await put(empty)).status,200);
    });
  } finally { await stop(); await rm(dir,{recursive:true,force:true}); }
});
