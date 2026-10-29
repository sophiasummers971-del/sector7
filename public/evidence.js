// Verdicts are derived from server records, never from animation or button clicks.
const verdict = (status, observed) => ({ status, observed });
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function executionOrder(definition) {
  if (!definition?.nodes?.length) return [];
  const order=[],seen=new Set();let node=definition.nodes.find(n=>n.type==='start');
  while(node&&!seen.has(node.id)){order.push(node.id);seen.add(node.id);const edge=definition.edges.find(e=>e.from===node.id);node=definition.nodes.find(n=>n.id===edge?.to)}
  return order.length===definition.nodes.length?order:[];
}
export function completedEvidence(task) {
  if (!task) return verdict('NOT VERIFIED','No run has been observed yet.');
  if (task.status !== 'completed') return verdict('NOT VERIFIED',`Server reports ${task.status}. Completion is not confirmed.`);
  if (!task.workflowSnapshot) return task.result?.message==='pong'?verdict('PASS','The legacy Ping returned pong. No graph snapshot exists.'):verdict('FAIL','Completed record has no pong result.');
  const order=executionOrder(task.workflowSnapshot.definition);
  if (!order.length || !same(order,task.nodeResults?.map(n=>n.id)) || !task.nodeResults.every(n=>n.status==='completed') || !(typeof task.result?.text==='string'||task.result?.message==='pong') || !same(task.result,task.nodeResults.at(-1).result))
    return verdict('FAIL','Completed record does not contain the expected executed chain and final output.');
  for (let index=0;index<order.length;index++) {
    const node=task.workflowSnapshot.definition.nodes.find(n=>n.id===order[index]),record=task.nodeResults[index];
    if(index && !same(record.inputs,task.nodeResults[index-1].result))return verdict('FAIL','A node did not receive its predecessor output.');
    if(node.type==='text.input' && record.result?.text!==node.settings.text)return verdict('FAIL','Text Input output differs from the snapshot.');
    if(node.type==='text.transform') {
      const text=record.inputs?.text,op=node.settings.operation;
      const expected=typeof text==='string'?(op==='uppercase'?text.toUpperCase():op==='lowercase'?text.toLowerCase():text.trim()):null;
      if(expected===null || record.result?.text!==expected)return verdict('FAIL','Text Transform output differs from its actual input and settings.');
    }
  }
  return verdict('PASS',`${order.length} nodes completed in snapshot order. Result matches the final node output.`);
}
export function repeatEvidence(before, response, tasks) {
  const after=response?.task;
  if (!before || !after || !tasks) return verdict('NOT VERIFIED','Retry the selected run and check the returned record.');
  if (response.duplicate!==true || after.id!==before.id || after.operationKey!==before.operationKey || !same(after.workflowSnapshot,before.workflowSnapshot) || tasks.filter(t=>t.operationKey===before.operationKey).length!==1)
    return verdict('FAIL','Retry did not return one original run with the same key and snapshot.');
  if (!same(before,after)) return verdict('NOT VERIFIED','The same run changed while checking it. Refresh and retry once its state is stable.');
  return verdict('PASS','Original run ID, snapshot, result and history returned unchanged. No second record for this key.');
}
export function pausedEvidence(task) {
  if (task?.status!=='WAITING_APPROVAL' || !task.waitingApproval || !task.workflowSnapshot) return verdict('NOT VERIFIED','Reach an Approval node to inspect the actual pause.');
  const order=executionOrder(task.workflowSnapshot.definition),index=order.indexOf(task.waitingApproval.nodeId);
  const records=task.nodeResults||[];
  if(index<0 || !same(records.map(n=>n.id),order.slice(0,index+1)) || records.at(-1)?.status!=='WAITING_APPROVAL' || records.slice(0,-1).some(n=>n.status!=='completed') || task.result!==null)
    return verdict('FAIL','Waiting record contains unexpected progress or a final result.');
  return verdict('PASS','Pause is persisted; nodes after this Approval have not executed.');
}
export function stopEvidence(paused,task,choice) {
  if(!paused||!task) return verdict('NOT VERIFIED','Observe a pause, then reject or cancel that run.');
  const status=choice==='reject'?'rejected':'cancelled';
  const order=executionOrder(paused.workflowSnapshot?.definition),index=order.indexOf(paused.waitingApproval?.nodeId);
  if(pausedEvidence(paused).status!=='PASS'||task.id!==paused.id||index<0||task.status!==status||task.result!==null||!same(task.workflowSnapshot,paused.workflowSnapshot)||!Array.isArray(task.nodeResults)||task.nodeResults.some(n=>order.slice(index+1).includes(n.id))||!task.approvals?.some(a=>a.approvalId===paused.waitingApproval.approvalId&&a.decision===choice))
    return verdict('FAIL','The returned record does not prove a terminal stop before downstream work.');
  return verdict('PASS',`Run ${status}. No node after the observed Approval executed. Upstream work is retained.`);
}
export function approvalEvidence(pauses,task) {
  const complete=completedEvidence(task);
  if(complete.status!=='PASS')return complete;
  const gates=task.workflowSnapshot?.definition.nodes.filter(n=>n.type==='approval')||[];
  if(!gates.length)return verdict('NOT VERIFIED','This snapshot contains no Approval node.');
  for(const gate of gates){const pause=pauses?.find(p=>p.waitingApproval?.nodeId===gate.id);
    if(!pause||pausedEvidence(pause).status!=='PASS'||!same(pause.workflowSnapshot,task.workflowSnapshot)||!task.approvals?.some(a=>a.approvalId===pause.waitingApproval.approvalId&&a.decision==='approve'))return verdict('NOT VERIFIED','Completion is recorded, but this session has not observed every approval pause and matching decision.');}
  return verdict('PASS','Each Approval pause was observed before its decision; the same snapshot then completed with its recorded output.');
}
export function restartEvidence(baseline, currentInstance, task, workflow, finalInstance=currentInstance) {
  if(!baseline)return verdict('NOT VERIFIED','Record a baseline, restart the Node server, then check the data.');
  if(currentInstance?.instanceId!==finalInstance?.instanceId)return verdict('NOT VERIFIED','Server changed during the check. Try the data check again.');
  if(!currentInstance?.instanceId||currentInstance.instanceId===baseline.instanceId)return verdict('NOT VERIFIED','Same server instance. A browser refresh is not a server restart.');
  if(!same(task,baseline.task)||!same(workflow,baseline.workflow))return verdict('FAIL','A different server instance responded, but the selected run or saved definition changed. Inspect history; do not clear data.');
  return verdict('PASS','Different server instance confirmed; selected run and saved workflow match the pre-restart baseline.');
}
