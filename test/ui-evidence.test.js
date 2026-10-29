import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDefinition,savedWorkflow,executeDefinition } from '../workflow.js';
import { completedEvidence,repeatEvidence,pausedEvidence,approvalEvidence,stopEvidence,restartEvidence } from '../public/evidence.js';
const snapshot=savedWorkflow(defaultDefinition);
const complete={id:'run-1',operationKey:'key-1',workflowSnapshot:snapshot,...executeDefinition(snapshot,'key-1')};
const gated=savedWorkflow({nodes:[...defaultDefinition.nodes,{id:'gate',type:'approval'}],edges:[{from:'start',to:'gate'},{from:'gate',to:'ping'},{from:'ping',to:'result'}]});
const execution=executeDefinition(gated,'key-2');
const paused={id:'run-2',operationKey:'key-2',workflowSnapshot:gated,nodeResults:execution.nodeResults,result:null,status:'WAITING_APPROVAL',waitingApproval:{...execution.waiting,approvalId:'pause-1'}};
test('normal verdict requires the complete snapshot order and final output',()=>{
  assert.equal(completedEvidence(null).status,'NOT VERIFIED');assert.equal(completedEvidence(complete).status,'PASS');
  const missing=structuredClone(complete);missing.nodeResults.splice(1,1);assert.equal(completedEvidence(missing).status,'FAIL');
  assert.equal(completedEvidence({...complete,status:'running'}).status,'NOT VERIFIED');
});
test('repeat verdict requires a duplicate flag, unchanged run and one key record',()=>{
  assert.equal(repeatEvidence(complete,{task:complete,duplicate:true},[complete]).status,'PASS');
  assert.equal(repeatEvidence(complete,{task:complete,duplicate:false},[complete]).status,'FAIL');
  assert.equal(repeatEvidence(complete,{task:complete,duplicate:true},[complete,complete]).status,'FAIL');
  assert.equal(repeatEvidence(complete,{task:{...complete,status:'interrupted'},duplicate:true},[complete]).status,'NOT VERIFIED');
});
test('pause evidence refuses downstream results even if status says waiting',()=>{
  assert.equal(pausedEvidence(paused).status,'PASS');const falsePause=structuredClone(paused);falsePause.nodeResults.push({id:'ping',status:'completed'});assert.equal(pausedEvidence(falsePause).status,'FAIL');
});
test('approval verdict needs observed pause plus matching decision receipt',()=>{
  const prefix=structuredClone(paused.nodeResults);prefix.at(-1).status='completed';prefix.at(-1).result=prefix.at(-1).inputs;
  const approved={...paused,...executeDefinition(gated,'key-2',prefix),approvals:[{approvalId:'pause-1',nodeId:'gate',decision:'approve'}]};
  assert.equal(approvalEvidence([],approved).status,'NOT VERIFIED');assert.equal(approvalEvidence([paused],approved).status,'PASS');assert.equal(approvalEvidence([paused],{...approved,approvals:[]}).status,'NOT VERIFIED');
});
test('reject/cancel verdict requires no downstream execution and the right receipt',()=>{
  for(const [choice,status]of [['reject','rejected'],['cancel','cancelled']]){
    const stopped={...structuredClone(paused),status,approvals:[{approvalId:'pause-1',decision:choice}]};stopped.nodeResults.at(-1).status=status;
    assert.equal(stopEvidence(paused,stopped,choice).status,'PASS');stopped.nodeResults.push({id:'ping',status:'completed'});assert.equal(stopEvidence(paused,stopped,choice).status,'FAIL');
  }
});
test('restart verdict cannot pass on browser refresh or a changed record',()=>{
  const baseline={instanceId:'server-before',task:complete,workflow:snapshot};
  assert.equal(restartEvidence(baseline,{instanceId:'server-before'},complete,snapshot).status,'NOT VERIFIED');
  assert.equal(restartEvidence(baseline,{instanceId:'server-after'},complete,snapshot).status,'PASS');
  assert.equal(restartEvidence(baseline,{instanceId:'server-after'},undefined,snapshot).status,'FAIL');
  assert.equal(restartEvidence(baseline,{instanceId:'server-after'},complete,snapshot,{instanceId:'server-third'}).status,'NOT VERIFIED');
});

test('text evidence checks settings and actual predecessor data rather than a sample result',()=>{
  const graph=savedWorkflow({nodes:[{id:'s',type:'start'},{id:'i',type:'text.input',settings:{text:' Mixed '}},{id:'t',type:'text.transform',settings:{operation:'uppercase'}},{id:'r',type:'result'}],edges:[{from:'s',to:'i'},{from:'i',to:'t'},{from:'t',to:'r'}]});
  const task={workflowSnapshot:graph,...executeDefinition(graph,'text-evidence')};
  assert.equal(completedEvidence(task).status,'PASS');
  const bad=structuredClone(task);bad.nodeResults[2].inputs.text='invented';assert.equal(completedEvidence(bad).status,'FAIL');
  const wrong=structuredClone(task);wrong.nodeResults[2].result.text='sample';assert.equal(completedEvidence(wrong).status,'FAIL');
});
