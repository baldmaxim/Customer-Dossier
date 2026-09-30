import { FC } from 'react';

import type { GraphEdgeType } from '../../api/types';
import styles from './GraphCanvas.module.css';

/** Образец линии рядом с подписью типа: подписи типов связей и есть легенда схемы. */
export const EdgeSample: FC<{ type: GraphEdgeType }> = ({ type }) => (
  <svg width="28" height="10" aria-hidden="true" focusable="false" className={styles.sample}>
    <line x1="0" y1="5" x2="28" y2="5" className={`${styles.edge} ${styles[`edge_${type}`] ?? ''}`} />
  </svg>
);
