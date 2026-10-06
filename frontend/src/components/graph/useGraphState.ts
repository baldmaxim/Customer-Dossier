// Фильтры и вид схемы — в памяти окна схемы (GraphButton): живут, пока окно открыто. Экрана «Связи» с
// фильтрами в адресе больше нет (06.10.2026). Интерфейс один — компоненты схемы не знают, где живёт состояние.

import { useState } from 'react';

import { DEFAULT_GRAPH_FILTERS, type GraphView, type IGraphFilters } from './graphModel';

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

/** Окно схемы: состояние живёт, пока окно открыто. Вид по умолчанию — по ширине экрана. */
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
