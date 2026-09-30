// Фильтры и вид схемы: в памяти (панель на карточке компании или объекта) или в адресе
// (экран «Связи»: схемой с фильтрами можно поделиться, «Назад» возвращает то же состояние).
// Интерфейс один — компоненты схемы не знают, где живёт состояние.

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { GraphEdgeType } from '../../api/types';
import { useUrlPatch, type UrlPatch } from '../../hooks/useUrlState';
import {
  DEFAULT_DEPTH,
  DEFAULT_EDGE_TYPES,
  DEFAULT_GRAPH_FILTERS,
  isEdgeType,
  isGraphDepth,
  sameTypes,
  type GraphView,
  type IGraphFilters,
} from './graphModel';

export interface IGraphState {
  filters: IGraphFilters;
  view: GraphView;
  setFilters: (patch: Partial<IGraphFilters>) => void;
  setView: (view: GraphView) => void;
  /** Сбросить то, что под «Ещё фильтры»; типы связей остаются. */
  resetExtra: () => void;
  /** Всё к умолчаниям, включая типы связей. */
  resetAll: () => void;
}

const EXTRA_DEFAULTS: Partial<IGraphFilters> = {
  depth: DEFAULT_GRAPH_FILTERS.depth,
  reviewedOnly: false,
  includeUnconfirmed: false,
  building: '',
  from: '',
  to: '',
};

/** Панель на карточке: состояние живёт, пока открыта страница. Вид по умолчанию — по ширине экрана. */
export const useLocalGraphState = (defaultView: GraphView): IGraphState => {
  const [filters, setAll] = useState<IGraphFilters>(DEFAULT_GRAPH_FILTERS);
  const [chosenView, setChosenView] = useState<GraphView | null>(null);
  return {
    filters,
    view: chosenView ?? defaultView,
    setFilters: patch => setAll(prev => ({ ...prev, ...patch })),
    setView: setChosenView,
    resetExtra: () => setAll(prev => ({ ...prev, ...EXTRA_DEFAULTS })),
    resetAll: () => setAll(DEFAULT_GRAPH_FILTERS),
  };
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const parseTypes = (raw: string | null): readonly GraphEdgeType[] => {
  if (raw === null) return DEFAULT_EDGE_TYPES;
  // Все типы выключены — отдельное значение: пустой параметр неотличим от отсутствующего.
  if (raw === 'none') return [];
  const list = raw.split(',').filter(isEdgeType);
  return list.length > 0 ? [...new Set(list)] : DEFAULT_EDGE_TYPES;
};

const parseDepth = (raw: string | null): IGraphFilters['depth'] => {
  const n = Number(raw);
  return raw !== null && isGraphDepth(n) ? n : DEFAULT_DEPTH;
};

const parseDate = (raw: string | null): string => (raw !== null && ISO_DATE.test(raw) ? raw : '');

/** Фильтры → параметры адреса. Значение по умолчанию убирает параметр: ссылка остаётся чистой. */
const toUrl = (patch: Partial<IGraphFilters>): UrlPatch => {
  const out: UrlPatch = {};
  if (patch.types !== undefined) {
    out.types = sameTypes(patch.types, DEFAULT_EDGE_TYPES) ? null : patch.types.length === 0 ? 'none' : patch.types.join(',');
  }
  if (patch.depth !== undefined) out.depth = patch.depth === DEFAULT_DEPTH ? null : patch.depth;
  if (patch.reviewedOnly !== undefined) out.reviewed = patch.reviewedOnly;
  if (patch.includeUnconfirmed !== undefined) out.unconfirmed = patch.includeUnconfirmed;
  if (patch.building !== undefined) out.building = patch.building.trim() === '' ? null : patch.building;
  if (patch.from !== undefined) out.from = patch.from || null;
  if (patch.to !== undefined) out.to = patch.to || null;
  return out;
};

/**
 * Экран «Связи»: всё в адресе (`types`, `depth`, `reviewed`, `unconfirmed`, `building`, `from`, `to`, `view`).
 * Фильтры и вид меняют адрес без новой записи истории: «Назад» ведёт к прежнему центру, а не
 * перебирает щелчки по флажкам.
 */
export const useUrlGraphState = (defaultView: GraphView): IGraphState => {
  const [params] = useSearchParams();
  const patch = useUrlPatch();

  const typesRaw = params.get('types');
  const depthRaw = params.get('depth');
  const reviewedRaw = params.get('reviewed');
  const unconfirmedRaw = params.get('unconfirmed');
  const building = params.get('building') ?? '';
  const fromRaw = params.get('from');
  const toRaw = params.get('to');
  const filters = useMemo<IGraphFilters>(
    () => ({
      types: parseTypes(typesRaw),
      depth: parseDepth(depthRaw),
      reviewedOnly: reviewedRaw === '1',
      includeUnconfirmed: unconfirmedRaw === '1',
      building,
      from: parseDate(fromRaw),
      to: parseDate(toRaw),
    }),
    [typesRaw, depthRaw, reviewedRaw, unconfirmedRaw, building, fromRaw, toRaw],
  );

  const rawView = params.get('view');
  const view: GraphView = rawView === 'schema' || rawView === 'table' ? rawView : defaultView;

  const setFilters = useCallback((next: Partial<IGraphFilters>) => patch(toUrl(next)), [patch]);
  const setView = useCallback((next: GraphView) => patch({ view: next === defaultView ? null : next }), [patch, defaultView]);
  const resetExtra = useCallback(() => patch(toUrl(EXTRA_DEFAULTS)), [patch]);
  const resetAll = useCallback(() => patch(toUrl(DEFAULT_GRAPH_FILTERS)), [patch]);

  return { filters, view, setFilters, setView, resetExtra, resetAll };
};
