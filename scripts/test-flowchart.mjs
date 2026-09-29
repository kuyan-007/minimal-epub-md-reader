import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFlowchart, renderFlowchart } from '../src/flowchart.mjs';

const markdown = readFileSync(new URL('../测试流程图.md', import.meta.url), 'utf8');
const diagrams = [...markdown.matchAll(/```mermaid\s*([\s\S]*?)```/g)].map((match) => match[1]);
assert.equal(diagrams.length, 2);

const vertical = parseFlowchart(diagrams[0]);
assert.equal(vertical.nodes.length, 5);
assert.equal(vertical.edges.length, 5);
assert.equal(vertical.nodes.find((node) => node.id === 'B').diamond, true);
assert.match(renderFlowchart(diagrams[0], 0), /文件格式\?/);

const horizontal = parseFlowchart(diagrams[1]);
assert.equal(horizontal.direction, 'LR');
assert.equal(horizontal.edges.length, 3);
assert.match(renderFlowchart('flowchart TD\nA[<测试>] --> B', 1), /&lt;测试&gt;/);
assert.throws(() => parseFlowchart('sequenceDiagram\nA -> B'));

console.log('流程图测试通过');
