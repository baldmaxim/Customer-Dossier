// «Откуда известно» у одной связи: цитаты сведения или, у структуры объекта и совместного
// упоминания, пояснение словами — у них нет своего сведения с цитатой.

import { FC } from 'react';

import type { IGraphEdge } from '../../api/types';
import { AssertionDetail } from '../AssertionDetail';
import { edgeFacts } from './graphText';
import styles from './Graph.module.css';

export const EdgeEvidence: FC<{ edge: IGraphEdge }> = ({ edge }) => {
  if (edge.assertionId) return <AssertionDetail assertionId={edge.assertionId} showSummary={false} />;
  const facts = edgeFacts(edge);
  if (facts.length === 0) return <p className={styles.muted}>У этой связи нет своей цитаты: она взята из структуры объекта.</p>;
  return (
    <ul className={styles.facts}>
      {facts.map(fact => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
};
