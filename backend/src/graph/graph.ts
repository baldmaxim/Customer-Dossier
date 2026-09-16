// Схема связей (этап 08B): ограниченный обход опубликованных утверждений вокруг выбранных узлов.
//
// Рёбра — только из утверждений со своим основанием: участие (компания → объект), договор (заказчик → исполнитель),
// корпоративная связь, структура объекта (корпус → комплекс), совместное упоминание (по умолчанию скрыто).
// Путь А→Б→В не превращается в ребро А→В: транзитивных рёбер нет вовсе. Толщина и цвет не кодируют надёжность.

import { overlap } from '../signals/intervals.js';

export const GRAPH_EDGE_TYPES = ['participation', 'contract', 'corporate', 'hierarchy', 'co_mentioned'] as const;
export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number];

export type NodeKey = `c:${number}` | `p:${number}`;

export interface IGraphNode {
  key: NodeKey;
  kind: 'company' | 'project';
  id: number;
  label: string;
  /** Вид сущности (юрлицо, бренд, группа) или уровень объекта (комплекс, очередь, корпус). */
  subtype: string | null;
  details: string[];
  depth: number;
  seed: boolean;
}

export interface IGraphEdge {
  key: string;
  type: GraphEdgeType;
  from: NodeKey;
  to: NodeKey;
  /** Утверждение-основание; у структуры объекта и совместного упоминания — null (основание в details). */
  assertionId: number | null;
  role: string | null;
  building: string | null;
  workPackage: string | null;
  validFrom: string | null;
  validTo: string | null;
  periodPrecision: string;
  status: string;
  polarity: string;
  modality: string;
  supports: number;
  contradicts: number;
  contextProjectId: number | null;
  details: string[];
}

export interface IGraphFilters {
  types: GraphEdgeType[];
  /** Только проверенные аналитиком утверждения. */
  reviewedOnly: boolean;
  /** Включать план, возможность, заявление и отрицание (подписанными), по умолчанию — нет. */
  includeUnconfirmed: boolean;
  projectId: number | null;
  building: string | null;
  from: string | null;
  to: string | null;
  depth: number;
  limit: number;
}

export const DEFAULT_FILTERS: IGraphFilters = {
  types: ['participation', 'contract', 'corporate', 'hierarchy'],
  reviewedOnly: false,
  includeUnconfirmed: false,
  projectId: null,
  building: null,
  from: null,
  to: null,
  depth: 2,
  limit: 60,
};

export const MAX_DEPTH = 3;
export const MAX_NODES = 150;

const TYPE_PRIORITY: Record<GraphEdgeType, number> = { contract: 0, participation: 1, corporate: 2, hierarchy: 3, co_mentioned: 4 };

/** Ребро проходит фильтры: тип, проверка, модальность, объект и корпус, пересечение периода. */
export const edgeMatches = (edge: IGraphEdge, filters: IGraphFilters): boolean => {
  if (!filters.types.includes(edge.type)) return false;
  if (edge.type !== 'hierarchy' && edge.type !== 'co_mentioned') {
    if (edge.status === 'rejected') return false;
    if (filters.reviewedOnly && edge.status !== 'reviewed_supported') return false;
    const confirmedShape = edge.polarity === 'positive' && ['reported_fact', 'unknown'].includes(edge.modality);
    if (!filters.includeUnconfirmed && !confirmedShape) return false;
  }
  if (filters.projectId !== null) {
    const touchesProject = edge.from === `p:${filters.projectId}` || edge.to === `p:${filters.projectId}` || edge.contextProjectId === filters.projectId;
    if ((edge.type === 'participation' || edge.type === 'contract') && !touchesProject) return false;
  }
  if (filters.building && edge.building && edge.building.toLowerCase() !== filters.building.toLowerCase()) return false;
  if ((filters.from || filters.to) && edge.validFrom) {
    const o = overlap({ validFrom: filters.from ?? '0001-01-01', validTo: filters.to ?? '9999-12-31' }, edge);
    if (o === 'no_overlap') return false;
  }
  return true;
};

export interface IGraphLoader {
  nodes: (keys: readonly NodeKey[]) => Promise<IGraphNode[]>;
  /** Все рёбра, касающиеся узлов фронта (без фильтра — фильтр чистый). */
  edges: (keys: readonly NodeKey[], types: readonly GraphEdgeType[]) => Promise<IGraphEdge[]>;
}

export interface IGraph {
  nodes: IGraphNode[];
  edges: IGraphEdge[];
  truncated: boolean;
  filters: IGraphFilters;
  notes: string[];
}

/**
 * Обход в ширину от узлов-основ: глубина ≤ 3, узлов ≤ 150, посещённые не повторяются (циклы не зацикливают).
 * При превышении лимита приоритет у договоров, затем участия, корпоративных связей, структуры и упоминаний.
 */
export const buildGraph = async (seeds: readonly NodeKey[], rawFilters: Partial<IGraphFilters>, loader: IGraphLoader): Promise<IGraph> => {
  const filters: IGraphFilters = {
    ...DEFAULT_FILTERS,
    ...rawFilters,
    depth: Math.max(0, Math.min(MAX_DEPTH, rawFilters.depth ?? DEFAULT_FILTERS.depth)),
    limit: Math.max(1, Math.min(MAX_NODES, rawFilters.limit ?? DEFAULT_FILTERS.limit)),
  };
  const depthOf = new Map<NodeKey, number>();
  for (const s of seeds) depthOf.set(s, 0);
  const edges = new Map<string, IGraphEdge>();
  let frontier = [...new Set(seeds)];
  let truncated = false;

  for (let depth = 0; depth < filters.depth && frontier.length > 0; depth += 1) {
    const found = (await loader.edges(frontier, filters.types))
      .filter(e => edgeMatches(e, filters))
      .sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type] || (a.assertionId ?? 0) - (b.assertionId ?? 0) || a.key.localeCompare(b.key));
    const next: NodeKey[] = [];
    for (const edge of found) {
      const ends = [edge.from, edge.to];
      const newEnds = ends.filter(k => !depthOf.has(k));
      if (depthOf.size + newEnds.length > filters.limit) {
        truncated = true;
        continue;
      }
      for (const k of newEnds) {
        depthOf.set(k, depth + 1);
        next.push(k);
      }
      edges.set(edge.key, edge);
    }
    frontier = next;
  }
  // Узлы последнего слоя могут иметь ещё соседей: это граница глубины, а не отсутствие связей.
  const depthLimited = frontier.length > 0;

  const nodes = await loader.nodes([...depthOf.keys()]);
  const byKey = new Map(nodes.map(n => [n.key, n]));
  const resultNodes = [...depthOf.entries()]
    .map(([key, depth]) => {
      const node = byKey.get(key);
      return node ? { ...node, depth, seed: seeds.includes(key) } : null;
    })
    .filter((n): n is IGraphNode => n !== null)
    .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));
  const present = new Set(resultNodes.map(n => n.key));

  return {
    nodes: resultNodes,
    edges: [...edges.values()].filter(e => present.has(e.from) && present.has(e.to)),
    truncated,
    filters,
    notes: [
      'Рёбра — только утверждения со своим основанием; путь через третью компанию не означает прямого договора.',
      'Совместное участие и совместное упоминание — не договор и не корпоративная связь.',
      truncated ? `Показаны не все связи: достигнут лимит ${filters.limit} узлов. Раскройте нужный узел.` : '',
      depthLimited ? `Глубина ограничена ${filters.depth}: у крайних узлов могут быть другие связи.` : '',
    ].filter(Boolean),
  };
};
