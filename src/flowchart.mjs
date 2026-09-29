const escapeXml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function parseNode(token) {
  const match = token.trim().match(/^([^\s[({}\]]+)(?:\[([^\]]+)\]|\{([^}]+)\}|\(([^)]+)\))?$/u);
  if (!match) throw new Error('不支持的节点语法');
  return { id: match[1], label: match[2] ?? match[3] ?? match[4] ?? match[1], diamond: match[3] !== undefined };
}

export function parseFlowchart(source) {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('%%'));
  const header = lines.shift()?.match(/^(?:flowchart|graph)\s+(TD|TB|LR)$/i);
  if (!header) throw new Error('仅支持 flowchart TD/TB/LR');
  const nodes = new Map();
  const edges = [];
  const addNode = (node) => {
    const previous = nodes.get(node.id);
    nodes.set(node.id, node.label === node.id && previous ? previous : node);
  };
  for (const line of lines) {
    const parts = line.split(/\s*-->(?:\|([^|]*)\|)?\s*/);
    if (parts.length === 1) {
      const node = parseNode(parts[0]);
      addNode(node);
      continue;
    }
    if (parts.length < 3 || parts.length % 2 !== 1) throw new Error('不支持的连线语法');
    let previous = parseNode(parts[0]);
    addNode(previous);
    for (let i = 1; i < parts.length; i += 2) {
      const next = parseNode(parts[i + 1]);
      addNode(next);
      edges.push({ from: previous.id, to: next.id, label: parts[i] });
      previous = next;
    }
  }
  if (!nodes.size) throw new Error('流程图为空');
  return { direction: header[1].toUpperCase(), nodes: [...nodes.values()], edges };
}

export function renderFlowchart(source, id) {
  const chart = parseFlowchart(source);
  const rank = new Map(chart.nodes.map((node) => [node.id, 0]));
  for (let i = 0; i < chart.nodes.length; i++) {
    let changed = false;
    for (const edge of chart.edges) {
      const next = rank.get(edge.from) + 1;
      if (next > rank.get(edge.to) && next < chart.nodes.length) {
        rank.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const groups = [];
  for (const node of chart.nodes) (groups[rank.get(node.id)] ??= []).push(node);
  const horizontal = chart.direction === 'LR';
  const maxGroup = Math.max(...groups.map((group) => group?.length ?? 0));
  const width = horizontal ? groups.length * 220 + 40 : maxGroup * 220 + 40;
  const height = horizontal ? maxGroup * 130 + 40 : groups.length * 130 + 40;
  const positions = new Map();
  for (let level = 0; level < groups.length; level++) {
    const group = groups[level] ?? [];
    group.forEach((node, index) => {
      const offset = (maxGroup - group.length) * 110;
      positions.set(node.id, horizontal
        ? { x: level * 220 + 120, y: index * 130 + 85 + offset / 2 }
        : { x: index * 220 + 120 + offset, y: level * 130 + 85 });
    });
  }
  const marker = `flow-arrow-${id}`;
  const arrows = chart.edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    const x1 = from.x + (horizontal ? 80 : 0);
    const y1 = from.y + (horizontal ? 0 : 32);
    const x2 = to.x - (horizontal ? 85 : 0);
    const y2 = to.y - (horizontal ? 0 : 37);
    const label = edge.label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 7}" text-anchor="middle" class="flow-edge-label">${escapeXml(edge.label)}</text>` : '';
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${marker})"/>${label}`;
  }).join('');
  const shapes = chart.nodes.map((node) => {
    const { x, y } = positions.get(node.id);
    const shape = node.diamond
      ? `<polygon points="${x},${y - 38} ${x + 85},${y} ${x},${y + 38} ${x - 85},${y}"/>`
      : `<rect x="${x - 80}" y="${y - 32}" width="160" height="64" rx="8"/>`;
    return `<g class="flow-node">${shape}<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${escapeXml(node.label)}</text></g>`;
  }).join('');
  return `<svg class="flowchart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="流程图"><defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="var(--accent)"/></marker></defs><g class="flow-edges">${arrows}</g>${shapes}</svg>`;
}

export function renderFlowcharts(doc) {
  if (!doc) return;
  doc.querySelectorAll('pre > code.language-mermaid').forEach((code, index) => {
    try {
      const wrapper = doc.createElement('div');
      wrapper.className = 'flowchart-wrapper';
      wrapper.innerHTML = renderFlowchart(code.textContent, index);
      code.parentElement.replaceWith(wrapper);
    } catch (error) {
      console.warn('流程图渲染失败，保留源码:', error);
    }
  });
}
