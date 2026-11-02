// Templates produce fresh local drafts; applying never saves or executes.
const chain = nodes => ({nodes,edges:nodes.slice(1).map((n,i)=>({from:nodes[i].id,to:n.id}))});
const text = (operation, message='') => chain([{id:'start',type:'start'},{id:'text',type:'text.input',settings:{text:message}},...(operation?[{id:'transform',type:'text.transform',settings:{operation}}]:[]),{id:'approval',type:'approval'},{id:'result',type:'result'}]);
export const workflowTemplates = [
 {id:'text-review',name:'Review a message',description:'Write a short message and approve its exact text.',definition:text(null)},
 {id:'clean-text',name:'Clean pasted text',description:'Trim leading and trailing whitespace, then review.',definition:text('trim')},
 {id:'uppercase',name:'Uppercase a message',description:'Convert a message to uppercase, then review.',definition:text('uppercase')},
 {id:'lowercase',name:'Lowercase a message',description:'Convert a message to lowercase, then review.',definition:text('lowercase')},
 {id:'health-check',name:'Local health check',description:'Run a harmless local Ping and show its result.',definition:chain([{id:'start',type:'start'},{id:'ping',type:'system.ping'},{id:'result',type:'result'}])}
];
export function templateDefinition(id) {
 const template=workflowTemplates.find(item=>item.id===id);
 if(!template)throw new Error('Unknown workflow template');
 return structuredClone(template.definition);
}
