import { createHash } from 'node:crypto';

export const defaultDefinition = {
  nodes: [{ id: 'start', type: 'start' }, { id: 'ping', type: 'system.ping' }, { id: 'result', type: 'result' }],
  edges: [{ from: 'start', to: 'ping' }, { from: 'ping', to: 'result' }]
};
export const MAX_TEXT_LENGTH = 500;
export const MAX_OUTPUT_LENGTH = 2000;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys;
function invalid(message) { const error = new Error(message); error.status = 400; throw error; }

export function validateDefinition(input) {
  if (!exact(input, 'edges,nodes') || !Array.isArray(input.nodes) || !Array.isArray(input.edges))
    invalid('Workflow must contain only nodes and edges arrays');
  if (input.nodes.length < 3 || input.nodes.length > 12) invalid('Use 3–12 nodes: one Start, one Result, and a Ping or Text Input');
  if (input.edges.length > 12) invalid('Too many connections for a linear chain');
  const nodes = new Map();
  for (const node of input.nodes) {
    const textNode = ['text.input','text.transform'].includes(node?.type);
    if (!exact(node, textNode ? 'id,settings,type' : 'id,type') || typeof node.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(node.id))
      invalid('Each node needs only an id (1–40 letters, digits, underscores or hyphens) and type');
    if (!['start', 'system.ping', 'text.input', 'text.transform', 'approval', 'result'].includes(node.type)) invalid('Unsupported node type: only Start, System Ping, Text Input, Text Transform, Approval and Result are allowed');
    if (nodes.has(node.id)) invalid(`Duplicate node id: ${node.id}`);
    if (node.type === 'text.input' && (!exact(node.settings,'text') || typeof node.settings.text !== 'string' || node.settings.text.length > MAX_TEXT_LENGTH)) invalid(`Text Input ${node.id} needs text of at most ${MAX_TEXT_LENGTH} UTF-16 code units`);
    if (node.type === 'text.transform' && (!exact(node.settings,'operation') || !['uppercase','lowercase','trim'].includes(node.settings.operation))) invalid(`Text Transform ${node.id} needs operation uppercase, lowercase or trim`);
    nodes.set(node.id, { id: node.id, type: node.type, ...(textNode ? {settings: structuredClone(node.settings)} : {}) });
  }
  if ([...nodes.values()].filter(node => node.type === 'start').length !== 1 ||
      [...nodes.values()].filter(node => node.type === 'result').length !== 1)
    invalid('Exactly one Start and one Result are required');
  if (![...nodes.values()].some(node => ['system.ping','text.input'].includes(node.type))) invalid('At least one System Ping or Text Input is required');
  const outgoing = new Map([...nodes.keys()].map(id => [id, []]));
  const incoming = new Map([...nodes.keys()].map(id => [id, []]));
  const seen = new Set();
  for (const edge of input.edges) {
    if (!exact(edge, 'from,to') || !nodes.has(edge.from) || !nodes.has(edge.to)) invalid('Connection endpoints must reference existing node ids');
    if (edge.from === edge.to) invalid('Cycles are not allowed (self-connection)');
    const key = JSON.stringify([edge.from, edge.to]);
    if (seen.has(key)) invalid('Duplicate connections are not allowed');
    seen.add(key); outgoing.get(edge.from).push(edge.to); incoming.get(edge.to).push(edge.from);
  }
  // Kahn's algorithm checks cycles in the whole graph, including isolated components.
  const degrees = new Map([...incoming].map(([id, values]) => [id, values.length]));
  const ready = [...degrees].filter(([, n]) => n === 0).map(([id]) => id);
  const order = [];
  while (ready.length) {
    const id = ready.shift(); order.push(id);
    for (const next of outgoing.get(id)) { degrees.set(next, degrees.get(next) - 1); if (degrees.get(next) === 0) ready.push(next); }
  }
  if (order.length !== nodes.size) invalid('Cycles are not allowed');
  // Check undirected connectivity before connection counts for a useful error.
  const connected = new Set(); const pending = [input.nodes[0].id];
  while (pending.length) { const id = pending.pop(); if (connected.has(id)) continue; connected.add(id); pending.push(...outgoing.get(id), ...incoming.get(id)); }
  if (connected.size !== nodes.size) invalid('Disconnected nodes: connect every node into one chain');
  for (const node of nodes.values()) {
    const ins = incoming.get(node.id).length, outs = outgoing.get(node.id).length;
    const valid = node.type === 'start' ? ins === 0 && outs === 1 : node.type === 'result' ? ins === 1 && outs === 0 : ins === 1 && outs === 1;
    if (!valid) invalid(`Invalid connections at ${node.id}: Start needs one output, Result one input, and intermediate nodes one of each; branching and merging are not supported`);
  }
  // Validate data flow and expansion limits before saving, without executing a run.
  let text = null;
  for (const id of order) {
    const node = nodes.get(id);
    if (node.type === 'text.input') text = node.settings.text;
    else if (node.type === 'system.ping') text = null;
    else if (node.type === 'text.transform') {
      if (text === null) invalid(`Text Transform ${id} requires upstream Text Input output`);
      text = transformText(text, node.settings.operation);
      if (text.length > MAX_OUTPUT_LENGTH) invalid(`Transformed text exceeds ${MAX_OUTPUT_LENGTH} UTF-16 code units`);
    }
  }
  return {
    definition: { nodes: [...nodes.values()].sort((a,b) => a.id.localeCompare(b.id)),
      edges: input.edges.map(edge => ({ from: edge.from, to: edge.to })).sort((a,b) => a.from.localeCompare(b.from)) },
    order
  };
}
export function savedWorkflow(input) {
  const { definition } = validateDefinition(input);
  return { revision: createHash('sha256').update(JSON.stringify(definition)).digest('hex'), definition };
}

function transformText(text, operation) { return operation === 'uppercase' ? text.toUpperCase() : operation === 'lowercase' ? text.toLowerCase() : text.trim(); }

// Continue only from a persisted completed prefix. Never evaluate user-supplied code.
export function executeDefinition(snapshot, operationKey, previousResults = []) {
  const { order } = validateDefinition(snapshot.definition);
  const nodes = new Map(snapshot.definition.nodes.map(node => [node.id, node]));
  const nodeResults = structuredClone(previousResults);
  if (nodeResults.some((record,index) => record.id !== order[index] || record.status !== 'completed'))
    throw new Error('Invalid completed execution prefix');
  let output = nodeResults.at(-1)?.result || null;
  for (const id of order.slice(nodeResults.length)) {
    const node = nodes.get(id);
    const inputs = node.type === 'start' ? { operationKey } : structuredClone(output);
    const at = new Date().toISOString();
    if (node.type === 'approval') {
      nodeResults.push({ id, type: node.type, status: 'WAITING_APPROVAL', inputs, result: null, at });
      const next = order.indexOf(id) + 1;
      const continuation = [];
      for (const nextId of order.slice(next)) {
        continuation.push({ id: nextId, type: nodes.get(nextId).type });
        if (nodes.get(nextId).type === 'approval') break;
      }
      return { nodeResults, result: null, status: 'WAITING_APPROVAL',
        waiting: { nodeId: id, nextAction: continuation[0], continuation, requestedAt: at } };
    }
    if (node.type === 'start') output = { operationKey };
    else if (node.type === 'system.ping') output = { message: 'pong', executedAt: at, nodeId: id };
    else if (node.type === 'text.input') output = { text: node.settings.text };
    else if (node.type === 'text.transform') output = { text: transformText(inputs.text, node.settings.operation) };
    // Result forwards its actual predecessor's output.
    nodeResults.push({ id, type: node.type, status: 'completed', inputs, result: structuredClone(output), at });
  }
  return { nodeResults, result: output, status: 'completed', waiting: null };
}
