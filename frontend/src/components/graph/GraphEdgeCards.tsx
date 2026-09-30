// Связи на телефоне: карточка — фраза «кто — какая связь — с кем», период и статус. Роль в фразе
// относится к первой стороне, поэтому порядок сторон не меняем; связь с центром кликается целиком.

import { FC, useId } from 'react';

import type { IGraph, IGraphNode } from '../../api/types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CardList } from '../ui/CardList';
import { EdgeEvidence } from './EdgeEvidence';
import { EdgeStatusBadge } from './EdgeStatusBadge';
import type { NodeTarget } from './graphModel';
import { edgeCaption, edgePeriod } from './graphText';
import { NodeName, rowTargetOf } from './NodeName';
import styles from './Graph.module.css';

interface IGraphEdgeCardsProps {
  graph: IGraph;
  nodes: ReadonlyMap<string, IGraphNode>;
  target: NodeTarget;
  caption: string;
  open: string | null;
  onToggle: (key: string) => void;
}

export const GraphEdgeCards: FC<IGraphEdgeCardsProps> = ({ graph, nodes, target, caption, open, onToggle }) => {
  const idBase = useId();
  return (
    <CardList label={caption}>
      {graph.edges.map(edge => {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        const rowTarget = rowTargetOf(from, to, target);
        const expanded = open === edge.key;
        const evidenceId = `${idBase}-${edge.key}`;
        const nameClass = (key: string): string => (rowTarget?.key === key ? 'row-link-target' : `row-link-above ${styles.nameLink}`);
        return (
          <Card as="li" key={edge.key} padding="sm" interactive={Boolean(rowTarget)} className={[styles.edgeCard, rowTarget ? 'row-link' : ''].filter(Boolean).join(' ')}>
            <p className={styles.sentence}>
              <NodeName node={from} fallback={edge.from} target={target} className={nameClass(edge.from)} /> — {edgeCaption(edge)} —{' '}
              <NodeName node={to} fallback={edge.to} target={target} className={nameClass(edge.to)} />
            </p>
            <div className={styles.detailMeta}>
              <span className="nowrap">{edgePeriod(edge)}</span>
              <EdgeStatusBadge edge={edge} />
            </div>
            <div className={`row-link-above ${styles.cardActions}`}>
              <Button variant="link" size="sm" aria-expanded={expanded} aria-controls={evidenceId} onClick={() => onToggle(edge.key)}>
                Откуда известно
              </Button>
            </div>
            {expanded && (
              <div id={evidenceId} className={`row-link-above ${styles.cardEvidence}`}>
                <EdgeEvidence edge={edge} />
              </div>
            )}
          </Card>
        );
      })}
    </CardList>
  );
};
