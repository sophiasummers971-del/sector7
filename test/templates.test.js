import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowTemplates, templateDefinition } from '../public/templates.js';
import { savedWorkflow, executeDefinition } from '../workflow.js';
test('Every offered template validates; text templates pause before Result',()=>{
 assert.equal(new Set(workflowTemplates.map(t=>t.id)).size,5);
 for(const t of workflowTemplates){
  const d=templateDefinition(t.id), run=executeDefinition(savedWorkflow(d),'test');
  if(t.id==='health-check'){assert.equal(run.status,'completed');assert.equal(run.result.message,'pong');}
  else {assert.equal(run.status,'WAITING_APPROVAL');assert.ok(!run.nodeResults.some(n=>n.type==='result'));assert.equal(d.nodes.find(n=>n.type==='text.input').settings.text,'');}
 }
});
test('Applying templates cannot mutate their catalog or another draft',()=>{
 const d=templateDefinition('clean-text');d.nodes[1].settings.text='  example  ';
 assert.equal(templateDefinition('clean-text').nodes[1].settings.text,'');
 assert.throws(()=>templateDefinition('__proto__'),/Unknown/);
});
