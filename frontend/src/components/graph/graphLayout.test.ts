// Раскладка схемы: слои по глубине, узлы не налезают друг на друга, линии не проходят сквозь узлы,
// концы линий у одного бока разнесены (нет «пучка» у центра).
import { describe, expect, it } from 'vitest';

import type { GraphEdgeType, IGraphEdge, IGraphNode } from '../../api/types';
import { NODE_H, NODE_W, layoutGraph } from './graphLayout';

const node = (key: string, depth: number, kind: 'company' | 'project' = 'company', seed = false): IGraphNode => ({
  key,
  kind,
  id: Number(key.replace(/\D/g, '')) || 1,
  label: `Узел ${key}`,
  subtype: null,
  details: [],
  depth,
  seed,
});

const edge = (key: string, from: string, to: string, type: GraphEdgeType = 'participation'): IGraphEdge => ({
  key,
  type,
  from,
  to,
  assertionId: 1,
  role: null,
  building: null,
  workPackage: null,
  validFrom: null,
  validTo: null,
  periodPrecision: 'unknown',
  status: 'text_grounded',
  polarity: 'positive',
  modality: 'reported_fact',
  supports: 1,
  contradicts: 0,
  contextProjectId: null,
  details: [],
});

const nodes = [
  node('c1', 0, 'company', true),
  node('p1', 1, 'project'),
  node('p2', 1, 'project'),
  node('c2', 1),
  node('c3', 2),
  node('c4', 2),
];
const edges = [
  edge('e1', 'c1', 'p1'),
  edge('e2', 'c1', 'p2'),
  edge('e3', 'c1', 'c2', 'contract'),
  edge('e4', 'c3', 'p1'),
  edge('e5', 'c2', 'c4', 'contract'),
  edge('e6', 'p1', 'p2', 'hierarchy'),
];

/** Числа из пути SVG: пары x y. */
const points = (d: string): Array<[number, number]> => {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i] ?? 0, nums[i + 1] ?? 0]);
  return out;
};

describe('раскладка схемы', () => {
  const layout = layoutGraph(nodes, edges);

  it('слои по глубине: центр в первой колонке, соседи — во второй, их соседи — в третьей', () => {
    const x = (key: string): number => layout.nodes.get(key)?.x ?? -1;
    expect(x('c1')).toBeLessThan(x('p1'));
    expect(x('p1')).toBe(x('c2'));
    expect(x('c3')).toBeGreaterThan(x('p1'));
    expect(x('c3')).toBe(x('c4'));
  });

  it('узлы одного слоя не налезают друг на друга', () => {
    const boxes = [...layout.nodes.values()];
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b || a.x !== b.x) continue;
        expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(NODE_H);
      }
    }
  });

  it('центр — по высоте среди своих соседей, а не у верхнего края', () => {
    const seed = layout.nodes.get('c1');
    const around = ['p1', 'p2', 'c2'].map(k => layout.nodes.get(k)?.y ?? 0);
    expect(seed?.y).toBeGreaterThanOrEqual(Math.min(...around));
    expect(seed?.y).toBeLessThanOrEqual(Math.max(...around));
  });

  it('у каждой связи есть путь, и опорные точки кривой не заходят внутрь узлов', () => {
    const boxes = [...layout.nodes.values()];
    for (const e of edges) {
      const d = layout.edges.get(e.key);
      expect(d, e.key).toBeTruthy();
      for (const [px, py] of points(d ?? '')) {
        const inside = boxes.some(b => px > b.x + 1 && px < b.x + NODE_W - 1 && py > b.y + 1 && py < b.y + NODE_H - 1);
        expect(inside, `${e.key}: точка ${px},${py}`).toBe(false);
      }
    }
  });

  it('концы нескольких связей у одного бока центра разнесены по высоте', () => {
    const starts = ['e1', 'e2', 'e3'].map(k => points(layout.edges.get(k) ?? '')[0]?.[1]);
    expect(new Set(starts).size).toBe(3);
  });

  it('схема помещается в свои размеры', () => {
    for (const b of layout.nodes.values()) {
      expect(b.x + NODE_W).toBeLessThanOrEqual(layout.width);
      expect(b.y + NODE_H).toBeLessThanOrEqual(layout.height);
      expect(b.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('связь с узлом, которого нет в ответе, не ломает раскладку', () => {
    const broken = layoutGraph(nodes, [...edges, edge('lost', 'c1', 'c404')]);
    expect(broken.edges.has('lost')).toBe(false);
    expect(broken.nodes.size).toBe(nodes.length);
  });
});
