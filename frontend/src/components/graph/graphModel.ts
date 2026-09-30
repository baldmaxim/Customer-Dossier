// Схема связей: фильтры, запрос к API и адреса узлов. Без React — это общая модель для панели
// на карточках (состояние в памяти) и экрана «Связи» (состояние в адресе).

import type { To } from 'react-router-dom';

import type { GraphEdgeType, IGraph, IGraphNode } from '../../api/types';

export const ALL_EDGE_TYPES: readonly GraphEdgeType[] = ['contract', 'participation', 'corporate', 'hierarchy', 'co_mentioned'];
/** Совместное упоминание скрыто по умолчанию: оно не означает связи (ADR-011). */
export const DEFAULT_EDGE_TYPES: readonly GraphEdgeType[] = ['contract', 'participation', 'corporate', 'hierarchy'];

export const GRAPH_DEPTHS = [1, 2, 3] as const;
export type GraphDepth = (typeof GRAPH_DEPTHS)[number];
export const DEFAULT_DEPTH: GraphDepth = 2;

export const GRAPH_VIEWS = ['schema', 'table'] as const;
export type GraphView = (typeof GRAPH_VIEWS)[number];

/** Узел-основа схемы: центр один — два центра в одном обходе читались бы как «эти двое связаны». */
export interface IGraphCenter {
  kind: 'company' | 'project';
  id: number;
}

export interface IGraphFilters {
  types: readonly GraphEdgeType[];
  depth: GraphDepth;
  reviewedOnly: boolean;
  includeUnconfirmed: boolean;
  building: string;
  from: string;
  to: string;
}

export const DEFAULT_GRAPH_FILTERS: IGraphFilters = {
  types: DEFAULT_EDGE_TYPES,
  depth: DEFAULT_DEPTH,
  reviewedOnly: false,
  includeUnconfirmed: false,
  building: '',
  from: '',
  to: '',
};

/** Сервер отдаёт больше, чем описано в api/types: причины, по которым загрузка связей усечена. */
export interface IGraphResponse extends IGraph {
  loaderTruncated?: string[];
}

export const isEdgeType = (value: string): value is GraphEdgeType => (ALL_EDGE_TYPES as readonly string[]).includes(value);

export const isGraphDepth = (value: number): value is GraphDepth => (GRAPH_DEPTHS as readonly number[]).includes(value);

export const sameTypes = (a: readonly GraphEdgeType[], b: readonly GraphEdgeType[]): boolean =>
  a.length === b.length && a.every(t => b.includes(t));

/** Центр из пропсов старого вида: companyId важнее projectId, как и раньше. */
export const centerOf = (companyId?: number, projectId?: number): IGraphCenter | null => {
  if (companyId && companyId > 0) return { kind: 'company', id: companyId };
  if (projectId && projectId > 0) return { kind: 'project', id: projectId };
  return null;
};

export const centerKey = (center: IGraphCenter | null): string => (center ? `${center.kind}:${center.id}` : '');

/** Параметры /api/graph: те же, что отправляла прежняя панель. */
export const graphSearch = (center: IGraphCenter, filters: IGraphFilters): string => {
  const search = new URLSearchParams();
  search.set(center.kind === 'company' ? 'companyId' : 'projectId', String(center.id));
  search.set('types', filters.types.join(','));
  search.set('depth', String(filters.depth));
  if (filters.reviewedOnly) search.set('reviewedOnly', 'true');
  if (filters.includeUnconfirmed) search.set('includeUnconfirmed', 'true');
  if (filters.building.trim()) search.set('building', filters.building.trim());
  if (filters.from) search.set('from', filters.from);
  if (filters.to) search.set('to', filters.to);
  return search.toString();
};

/** Сколько фильтров под «Ещё фильтры» отличается от умолчаний — счётчик на кнопке раскрытия. */
export const extraFilterCount = (filters: IGraphFilters): number =>
  [
    filters.depth !== DEFAULT_DEPTH,
    filters.reviewedOnly,
    filters.includeUnconfirmed,
    filters.building.trim() !== '',
    filters.from !== '',
    filters.to !== '',
  ].filter(Boolean).length;

export const isDefaultFilters = (filters: IGraphFilters): boolean =>
  extraFilterCount(filters) === 0 && sameTypes(filters.types, DEFAULT_EDGE_TYPES);

/**
 * Что делает нажатие на узел схемы и на имя в таблице связей. На «Связях» — показать связи
 * этого узла (ссылка на тот же экран с новым центром), на карточках — открыть карточку узла.
 * `actionText` — глагол для имени ссылки у диктора: «показать связи», «открыть карточку».
 */
export type NodeTarget =
  | { kind: 'link'; to: (node: IGraphNode) => To | null; state?: (node: IGraphNode) => unknown; viewTransition: boolean; actionText: string }
  | { kind: 'button'; onActivate: (node: IGraphNode) => void; actionText: string }
  | { kind: 'none' };

/** Карточка узла: компания или объект. */
export const nodeCardHref = (node: Pick<IGraphNode, 'kind' | 'id'>): string =>
  node.kind === 'company' ? `/company/${node.id}` : `/projects/${node.id}`;

/**
 * Экран «Связи» с другим центром и теми же фильтрами и видом: соседа смотрят в тех же
 * условиях, а «Назад» возвращает прежний центр.
 */
export const linksHref = (center: IGraphCenter, current?: URLSearchParams): string => {
  const search = new URLSearchParams(current);
  search.delete('company');
  search.delete('project');
  const out = new URLSearchParams({ [center.kind]: String(center.id) });
  search.forEach((value, key) => out.set(key, value));
  return `/links?${out.toString()}`;
};
