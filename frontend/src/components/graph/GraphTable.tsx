// Связи списком — тот же состав, что на схеме, и основной путь для диктора и телефона.
// С 900px — таблица, уже — карточки: шесть колонок на планшете уезжали вбок. У связи с центром
// строка целиком ведёт ко второму её концу (`.row-link`); у связи двух соседей целей две —
// имена остаются отдельными ссылками.

import { FC, Fragment, useId, useMemo, useState } from 'react';

import type { IGraph } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MQ } from '../../lib/media';
import { Button } from '../ui/Button';
import { TableScroll } from '../ui/TableScroll';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { EdgeEvidence } from './EdgeEvidence';
import { EdgeStatusBadge } from './EdgeStatusBadge';
import { GraphEdgeCards } from './GraphEdgeCards';
import type { NodeTarget } from './graphModel';
import { edgeCaption, edgePeriod } from './graphText';
import { NodeName, rowTargetOf } from './NodeName';
import styles from './Graph.module.css';

export interface IGraphTableProps {
  graph: IGraph;
  target: NodeTarget;
  caption: string;
}

export const GraphTable: FC<IGraphTableProps> = ({ graph, target, caption }) => {
  const wide = useMediaQuery(MQ.md);
  const [open, setOpen] = useState<string | null>(null);
  const idBase = useId();
  const nodes = useMemo(() => new Map(graph.nodes.map(n => [n.key, n])), [graph]);
  const toggle = (key: string): void => setOpen(prev => (prev === key ? null : key));

  if (!wide) return <GraphEdgeCards graph={graph} nodes={nodes} target={target} caption={caption} open={open} onToggle={toggle} />;

  return (
    <TableScroll label={caption} caption={caption} minWidth={760}>
      <colgroup>
        <col className={styles.colWho} />
        <col className={styles.colLink} />
        <col className={styles.colWhom} />
        <col />
        <col />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Кто</th>
          <th scope="col">Связь</th>
          <th scope="col">С кем</th>
          <th scope="col">Период</th>
          <th scope="col">Статус</th>
          <th scope="col">
            <VisuallyHidden>Откуда известно</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {graph.edges.map(edge => {
          const from = nodes.get(edge.from);
          const to = nodes.get(edge.to);
          const rowTarget = rowTargetOf(from, to, target);
          const expanded = open === edge.key;
          const evidenceId = `${idBase}-${edge.key}`;
          const nameClass = (key: string): string | undefined => (rowTarget?.key === key ? 'row-link-target' : `row-link-above ${styles.nameLink}`);
          return (
            <Fragment key={edge.key}>
              <tr className={rowTarget ? 'row-link' : undefined}>
                <td>
                  <NodeName node={from} fallback={edge.from} target={target} className={nameClass(edge.from)} />
                </td>
                <td>{edgeCaption(edge)}</td>
                <td>
                  <NodeName node={to} fallback={edge.to} target={target} className={nameClass(edge.to)} />
                </td>
                <td className="nowrap">{edgePeriod(edge)}</td>
                <td>
                  <EdgeStatusBadge edge={edge} />
                </td>
                <td className="row-link-above nowrap">
                  <Button variant="link" size="sm" aria-expanded={expanded} aria-controls={evidenceId} onClick={() => toggle(edge.key)}>
                    Откуда известно
                  </Button>
                </td>
              </tr>
              {expanded && (
                <tr className={styles.evidenceRow}>
                  <td colSpan={6} id={evidenceId}>
                    <EdgeEvidence edge={edge} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </TableScroll>
  );
};
