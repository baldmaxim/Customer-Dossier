// Панель под схемой: выбранная линия словами («кто — какая связь — с кем»), период, статус и цитаты.

import { FC, Ref, useId } from 'react';

import type { IGraphEdge, IGraphNode } from '../../api/types';
import { formatCountWord } from '../../lib/format';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Heading } from '../ui/Heading';
import { HeadingLevelContext, deeper, useHeadingLevel } from '../ui/headingLevel';
import { EdgeEvidence } from './EdgeEvidence';
import { EdgeStatusBadge } from './EdgeStatusBadge';
import type { NodeTarget } from './graphModel';
import { edgeCaption, edgePeriod } from './graphText';
import { NodeName } from './NodeName';
import styles from './Graph.module.css';

interface IGraphEdgeDetailProps {
  edge: IGraphEdge;
  nodes: ReadonlyMap<string, IGraphNode>;
  target: NodeTarget;
  id: string;
  onClose: () => void;
  ref?: Ref<HTMLElement>;
}

const QUOTES = ['цитата', 'цитаты', 'цитат'] as const;

/** Сколько цитат за и против — у связи-сведения; у структуры объекта счётчиков нет. */
export const edgeCounts = (edge: IGraphEdge): string | null => {
  if (!edge.assertionId) return null;
  const parts = [`подтверждают: ${formatCountWord(edge.supports, QUOTES)}`];
  if (edge.contradicts > 0) parts.push(`опровергают: ${formatCountWord(edge.contradicts, QUOTES)}`);
  return parts.join(' · ');
};

export const GraphEdgeDetail: FC<IGraphEdgeDetailProps> = ({ edge, nodes, target, id, onClose, ref }) => {
  const headingId = useId();
  const level = useHeadingLevel();
  const counts = edgeCounts(edge);
  return (
    // Обёртка — цель фокуса после выбора линии: с клавиатуры человек попадает прямо к цитатам.
    <section ref={ref} id={id} tabIndex={-1} aria-labelledby={headingId} className={styles.detailWrap}>
      <Card className={styles.detail}>
        <div className={styles.detailHead}>
          <Heading id={headingId} className={styles.detailTitle}>
            Откуда известно
          </Heading>
          <Button variant="ghost" size="sm" iconOnly icon="close" aria-label="Закрыть: откуда известно" onClick={onClose} />
        </div>
        <p className={styles.sentence}>
          <NodeName node={nodes.get(edge.from)} fallback={edge.from} target={target} /> — {edgeCaption(edge)} —{' '}
          <NodeName node={nodes.get(edge.to)} fallback={edge.to} target={target} />
        </p>
        <div className={styles.detailMeta}>
          <span className="nowrap">{edgePeriod(edge)}</span>
          <EdgeStatusBadge edge={edge} />
          {counts && <span>{counts}</span>}
        </div>
        {/* Заголовки групп цитат — ступенью ниже «Откуда известно». */}
        <HeadingLevelContext.Provider value={deeper(level)}>
          <EdgeEvidence edge={edge} />
        </HeadingLevelContext.Provider>
      </Card>
    </section>
  );
};
