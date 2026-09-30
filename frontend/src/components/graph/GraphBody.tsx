// Тело схемы: вид (схема или таблица), счётчики, сама схема или таблица, «Откуда известно» и
// пояснения. Загрузка, ошибка и «связей нет» — по одной схеме с остальным порталом.

import { FC, ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import type { IGraphEdge } from '../../api/types';
import { formatCount } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';
import { scrollBehavior } from '../../lib/motion';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Loading } from '../ui/Loading';
import { Segmented } from '../ui/Segmented';
import { Skeleton } from '../ui/Skeleton';
import { GraphCanvas } from './GraphCanvas';
import { GraphEdgeDetail } from './GraphEdgeDetail';
import { isDefaultFilters, type GraphView, type IGraphResponse, type NodeTarget } from './graphModel';
import { GraphNotes } from './GraphNotes';
import { GraphTable } from './GraphTable';
import type { IGraphState } from './useGraphState';
import styles from './Graph.module.css';

const VIEWS: ReadonlyArray<{ value: GraphView; label: string }> = [
  { value: 'schema', label: 'Схема' },
  { value: 'table', label: 'Таблица' },
];

export interface IGraphBodyProps {
  query: UseQueryResult<IGraphResponse>;
  state: IGraphState;
  target: NodeTarget;
  /** Чья схема — для имени схемы и таблицы у диктора. */
  centerName: string | null;
  size?: 'md' | 'lg';
  /** Что делает нажатие на узел — первой строкой пояснений под схемой. */
  hint?: string;
}

type Focusable = HTMLElement | SVGElement;

export const GraphBody: FC<IGraphBodyProps> = ({ query, state, target, centerName, size = 'md', hint }) => {
  const graph = query.data;
  const detailId = useId();
  const detailRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<Focusable | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const nodes = useMemo(() => new Map((graph?.nodes ?? []).map(n => [n.key, n])), [graph]);
  const selectedEdge = graph?.edges.find(e => e.key === selected) ?? null;

  // Выбрали линию — фокус и прокрутка к «Откуда известно»: с клавиатуры иначе до цитат не дойти.
  // Зависимость — ключ линии, а не объект: перестроение схемы по фильтру фокус не уводит.
  useEffect(() => {
    const panel = detailRef.current;
    if (!selected || !panel) return;
    panel.focus({ preventScroll: true });
    // jsdom и старые движки без scrollIntoView — фокус всё равно на месте.
    if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  }, [selected]);

  if (!graph) {
    if (query.isError) {
      return (
        <Callout tone="danger" title="Схема не построилась" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
          {describeLoadError(query.error)}
        </Callout>
      );
    }
    return (
      <Loading label="Строю схему…">
        <Skeleton height="280px" radius="md" />
      </Loading>
    );
  }

  const select = (edge: IGraphEdge): void => {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    setSelected(prev => (prev === edge.key ? null : edge.key));
  };
  const close = (): void => {
    setSelected(null);
    const back = returnFocus.current;
    if (back?.isConnected) back.focus();
  };

  const busy = query.isFetching;
  const title = centerName ? `Связи: ${centerName}` : 'Связи';
  const label =
    `Схема связей${centerName ? `: ${centerName}` : ''}. Компаний и объектов: ${graph.nodes.length}, связей: ${graph.edges.length}. ` +
    'Линия открывает цитаты; то же списком — вид «Таблица».';
  const toolbar: ReactNode = (
    <>
      <Segmented label="Вид" items={VIEWS} value={state.view} onChange={state.setView} />
      <p className={styles.counts}>
        <span>
          Компаний и объектов: <span className="num">{formatCount(graph.nodes.length)}</span>
        </span>
        <span>
          связей: <span className="num">{formatCount(graph.edges.length)}</span>
        </span>
        {graph.truncated && <Badge tone="warning">показаны не все</Badge>}
      </p>
      {busy && <Loading label="Обновляю схему…" />}
    </>
  );

  return (
    <div className={styles.body}>
      {query.isError && (
        <Callout tone="danger" title="Схема не обновилась" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
          {describeLoadError(query.error)} На экране — прежняя схема.
        </Callout>
      )}
      {graph.edges.length === 0 ? (
        <>
          <div className={styles.toolbar}>{toolbar}</div>
          <EmptyState
            title="Связей не найдено"
            action={isDefaultFilters(state.filters) ? undefined : <Button onClick={state.resetAll}>Сбросить фильтры</Button>}
          >
            По выбранным фильтрам связей нет. Это не значит, что их нет вовсе: в собранных публикациях они могли не встретиться.
          </EmptyState>
        </>
      ) : state.view === 'schema' ? (
        <>
          <GraphCanvas
            // Другой центр — другая схема: масштаб и прокрутка прежней к ней не относятся.
            key={graph.nodes.find(n => n.seed)?.key ?? 'graph'}
            graph={graph}
            label={label}
            target={target}
            selectedEdge={selected}
            onSelectEdge={select}
            detailId={detailId}
            busy={busy}
            size={size}
            toolbar={toolbar}
          />
          {selectedEdge && <GraphEdgeDetail ref={detailRef} edge={selectedEdge} nodes={nodes} target={target} id={detailId} onClose={close} />}
        </>
      ) : (
        <>
          <div className={styles.toolbar}>{toolbar}</div>
          <GraphTable graph={graph} target={target} caption={title} />
        </>
      )}
      <GraphNotes graph={graph} hint={hint} />
    </div>
  );
};
