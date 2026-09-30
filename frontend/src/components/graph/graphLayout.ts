// Раскладка схемы без библиотек: слои по глубине обхода от центра (центр слева), порядок в слое —
// по соседям в соседнем слое (барицентры), высота — к соседям, без наложений.
//
// Почему рёбра не идут поверх узлов: обход в ширину даёт рёбра только между соседними слоями и
// внутри слоя. Ребро соседних слоёв — кривая в промежутке между колонками; ребро внутри слоя —
// дуга справа от колонки, не длиннее промежутка; редкое ребро через слой (не из обхода) обходит
// схему сверху. Концы рёбер у одного бока узла разнесены по высоте — у центра больше нет «пучка».

import type { GraphEdgeType, IGraphEdge, IGraphNode } from '../../api/types';

export const NODE_W = 208;
export const NODE_H = 60;
const GAP_X = 104; // между колонками идут рёбра соседних слоёв и дуги внутри слоя
const GAP_Y = 14;
const PAD = 16;
const ATTACH_INSET = 12; // концы рёбер не ближе к углам узла
const ATTACH_STEP = 9;
const LANE_STEP = 10;
const LANE_TOP = 12;

export interface INodeBox {
  key: string;
  x: number;
  y: number;
  layer: number;
}

export interface IGraphLayout {
  nodes: Map<string, INodeBox>;
  /** Ключ ребра → путь SVG (атрибут d). */
  edges: Map<string, string>;
  width: number;
  height: number;
}

type Side = 'left' | 'right';

/** Порядок в слое при равных соседях: договоры и корпоративные связи выше участия и структуры. */
const TYPE_ORDER: Record<GraphEdgeType, number> = { contract: 0, corporate: 1, participation: 2, hierarchy: 3, co_mentioned: 4 };

const collator = new Intl.Collator('ru');

const mean = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

const compare = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);

export const layoutGraph = (nodes: readonly IGraphNode[], allEdges: readonly IGraphEdge[]): IGraphLayout => {
  const byKey = new Map(nodes.map(n => [n.key, n]));
  const edges = allEdges.filter(e => e.from !== e.to && byKey.has(e.from) && byKey.has(e.to));

  const depths = [...new Set(nodes.map(n => n.depth))].sort((a, b) => a - b);
  const layerOf = new Map(nodes.map(n => [n.key, depths.indexOf(n.depth)]));
  const layers: IGraphNode[][] = depths.map(d => nodes.filter(n => n.depth === d));

  const neighbors = new Map<string, string[]>();
  const bestType = new Map<string, number>();
  const connect = (a: string, b: string, type: GraphEdgeType): void => {
    neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
    bestType.set(a, Math.min(bestType.get(a) ?? 9, TYPE_ORDER[type]));
  };
  for (const e of edges) {
    connect(e.from, e.to, e.type);
    connect(e.to, e.from, e.type);
  }

  // Порядок в слое: сначала по виду связи и названию, потом три прохода барицентров.
  const order = new Map<string, number>();
  const remember = (layer: IGraphNode[]): void => layer.forEach((n, i) => order.set(n.key, i));
  for (const layer of layers) {
    layer.sort((a, b) => (bestType.get(a.key) ?? 9) - (bestType.get(b.key) ?? 9) || collator.compare(a.label, b.label));
    remember(layer);
  }
  const sweep = (index: number, ref: number): void => {
    const layer = layers[index];
    if (!layer) return;
    const center = new Map(
      layer.map(n => {
        const refs = (neighbors.get(n.key) ?? []).filter(k => layerOf.get(k) === ref).map(k => order.get(k) ?? 0);
        // Без соседей в опорном слое узел остаётся примерно на своём месте.
        return [n.key, refs.length > 0 ? mean(refs) : (order.get(n.key) ?? 0)] as const;
      }),
    );
    layer.sort((a, b) => compare(center.get(a.key) ?? 0, center.get(b.key) ?? 0) || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
    remember(layer);
  };
  for (let i = 1; i < layers.length; i += 1) sweep(i, i - 1);
  for (let i = layers.length - 2; i >= 1; i -= 1) sweep(i, i + 1);
  for (let i = 1; i < layers.length; i += 1) sweep(i, i - 1);

  // Высота: слой ставится к среднему своих соседей в предыдущем слое, узлы не налезают друг на друга.
  const slot = NODE_H + GAP_Y;
  const top = new Map<string, number>();
  layers.forEach((layer, i) => {
    if (i === 0) {
      layer.forEach((n, j) => top.set(n.key, j * slot));
      return;
    }
    const desired = layer.map(n => {
      const refs = (neighbors.get(n.key) ?? [])
        .filter(k => layerOf.get(k) === i - 1)
        .map(k => top.get(k))
        .filter((v): v is number => v !== undefined);
      return refs.length > 0 ? mean(refs) : null;
    });
    const placed: number[] = [];
    desired.forEach((want, j) => {
      const floor = j > 0 ? (placed[j - 1] ?? 0) + slot : Number.NEGATIVE_INFINITY;
      placed.push(Math.max(want ?? (j > 0 ? floor : 0), floor));
    });
    // Проход сверху вниз только толкает вниз — поднимаем блок на средний перекос.
    const deltas = desired.flatMap((want, j) => (want === null ? [] : [want - (placed[j] ?? 0)]));
    const shift = deltas.length > 0 ? mean(deltas) : 0;
    layer.forEach((n, j) => top.set(n.key, (placed[j] ?? 0) + shift));
  });
  // Одиночный центр — посередине своих соседей.
  const first = layers[0];
  if (first && first.length === 1 && first[0]) {
    const seed = first[0];
    const around = (neighbors.get(seed.key) ?? []).map(k => top.get(k)).filter((v): v is number => v !== undefined);
    if (around.length > 0) top.set(seed.key, mean(around));
  }

  // Стороны рёбер и число «обходов сверху» (от них зависит отступ сверху).
  const plan = edges.map(e => {
    const la = layerOf.get(e.from) ?? 0;
    const lb = layerOf.get(e.to) ?? 0;
    const fromSide: Side = la <= lb ? 'right' : 'left';
    const toSide: Side = la === lb || la > lb ? 'right' : 'left';
    return { e, la, lb, fromSide, toSide };
  });
  const lanes = plan.filter(p => Math.abs(p.la - p.lb) > 1).length;
  const laneSpace = lanes > 0 ? LANE_TOP + lanes * LANE_STEP : 0;

  const minTop = Math.min(...[...top.values()], 0);
  const boxes = new Map<string, INodeBox>();
  for (const n of nodes) {
    const layer = layerOf.get(n.key) ?? 0;
    boxes.set(n.key, { key: n.key, layer, x: PAD + layer * (NODE_W + GAP_X), y: PAD + laneSpace + (top.get(n.key) ?? 0) - minTop });
  }
  const midY = (key: string): number => (boxes.get(key)?.y ?? 0) + NODE_H / 2;

  // Концы рёбер у одного бока узла — по высоте другого конца, с шагом.
  const ends = new Map<string, Array<{ edge: string; node: string; other: number }>>();
  const addEnd = (node: string, side: Side, edge: string, other: string): void => {
    const key = `${node}|${side}`;
    ends.set(key, [...(ends.get(key) ?? []), { edge, node, other: midY(other) }]);
  };
  for (const p of plan) {
    addEnd(p.e.from, p.fromSide, p.e.key, p.e.to);
    addEnd(p.e.to, p.toSide, p.e.key, p.e.from);
  }
  const attach = new Map<string, number>();
  for (const list of ends.values()) {
    list.sort((a, b) => a.other - b.other);
    const step = list.length > 1 ? Math.min(ATTACH_STEP, (NODE_H - 2 * ATTACH_INSET) / (list.length - 1)) : 0;
    list.forEach((end, i) => attach.set(`${end.edge}|${end.node}`, midY(end.node) + (i - (list.length - 1) / 2) * step));
  }

  const paths = new Map<string, string>();
  let lane = 0;
  let arcsInLastLayer = false;
  for (const p of plan) {
    const a = boxes.get(p.e.from);
    const b = boxes.get(p.e.to);
    if (!a || !b) continue;
    const x1 = p.fromSide === 'right' ? a.x + NODE_W : a.x;
    const x2 = p.toSide === 'right' ? b.x + NODE_W : b.x;
    const y1 = attach.get(`${p.e.key}|${p.e.from}`) ?? midY(p.e.from);
    const y2 = attach.get(`${p.e.key}|${p.e.to}`) ?? midY(p.e.to);
    if (p.la === p.lb) {
      // Дуга справа от колонки: её выступ (≈ 3/4 от c) меньше промежутка до следующей колонки.
      const c = Math.min(GAP_X * 0.9, 28 + Math.abs(y2 - y1) * 0.3);
      paths.set(p.e.key, `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 + c} ${y2}, ${x2} ${y2}`);
      if (p.la === layers.length - 1) arcsInLastLayer = true;
    } else if (Math.abs(p.la - p.lb) === 1) {
      const mid = (x1 + x2) / 2;
      paths.set(p.e.key, `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
    } else {
      const laneY = PAD + lane * LANE_STEP;
      lane += 1;
      const s = x2 > x1 ? 1 : -1;
      paths.set(
        p.e.key,
        `M ${x1} ${y1} C ${x1 + s * 40} ${y1}, ${x1 + s * 40} ${laneY}, ${x1 + s * 64} ${laneY} ` +
          `L ${x2 - s * 64} ${laneY} C ${x2 - s * 40} ${laneY}, ${x2 - s * 40} ${y2}, ${x2} ${y2}`,
      );
    }
  }

  const columns = Math.max(layers.length, 1);
  const width = PAD * 2 + columns * NODE_W + (columns - 1) * GAP_X + (arcsInLastLayer ? GAP_X : 0);
  const bottom = Math.max(...[...boxes.values()].map(box => box.y + NODE_H), PAD + NODE_H);
  return { nodes: boxes, edges: paths, width, height: bottom + PAD };
};
