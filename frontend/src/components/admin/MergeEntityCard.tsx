import { FC } from 'react';

import type { IMergeEntitySummary, IMergePreview } from '../../api/types';
import { ENTITY_TYPE_LABELS, NO_IDENTIFIERS_TEXT, PROJECT_LEVEL_LABELS, formatIdentifier } from '../../lib/labels';
import styles from './Merge.module.css';

interface IMergeEntityCardProps {
  /** «Эта карточка» или «войдёт в». */
  role: string;
  entity: IMergeEntitySummary;
  kind: IMergePreview['kind'];
}

/** Одна сторона сравнения: название, вид, город и реквизиты словами — без номеров и версий. */
export const MergeEntityCard: FC<IMergeEntityCardProps> = ({ role, entity, kind }) => {
  const facts = [
    kind === 'company'
      ? [ENTITY_TYPE_LABELS[entity.entityType ?? 'unknown'] ?? ENTITY_TYPE_LABELS.unknown, entity.legalForm].filter(Boolean).join(', ')
      : (PROJECT_LEVEL_LABELS[entity.projectLevel ?? 'complex'] ?? 'объект'),
    entity.city ?? 'город неизвестен',
  ].join(' · ');
  return (
    <div className={styles.entity}>
      <span className={styles.entityRole}>{role}</span>
      <span className={styles.entityName}>{entity.name}</span>
      <span className={styles.muted}>{facts}</span>
      <span className={styles.muted}>
        {entity.identifiers.length > 0 ? entity.identifiers.map(formatIdentifier).join(', ') : NO_IDENTIFIERS_TEXT}
      </span>
      {entity.aliases.length > 0 && <span className={styles.muted}>также: {entity.aliases.join(', ')}</span>}
    </div>
  );
};
