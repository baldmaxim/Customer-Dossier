import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IProjectContext } from '../api/types';
import {
  ASSERTION_ROLE_LABELS,
  CONTEXT_STATE_LABELS,
  EVENT_LABELS,
  MODALITY_LABELS,
  OVERLAP_LABELS,
  PRECISION_LABELS,
  REVIEW_LEVEL_LABELS,
  formatDate,
} from '../lib/labels';
import styles from './CompanySignals.module.css';

interface IProjectContextPanelProps {
  companyId: number;
  projectId: number;
  projectName: string;
}

const period = (from: string | null, to: string | null, precision: string): string => {
  if (!from && !to) return 'период неизвестен';
  const text = `${from ? `с ${formatDate(from)}` : ''}${to ? ` по ${formatDate(to)}` : ''}`.trim();
  return precision !== 'day' ? `${text} (${PRECISION_LABELS[precision] ?? precision})` : text;
};

/** Контекст объекта: участие компании и события объекта с пересечением периодов — без вывода о вине. */
export const ProjectContextPanel: FC<IProjectContextPanelProps> = ({ companyId, projectId, projectName }) => {
  const contextQuery = useQuery({
    queryKey: ['company', companyId, 'context', projectId],
    queryFn: () => api.get<IProjectContext>(`/api/companies/${companyId}/context?projectId=${projectId}`),
  });
  if (contextQuery.isLoading) return <p className={styles.muted}>Загрузка контекста…</p>;
  if (contextQuery.isError || !contextQuery.data) return <p className={styles.muted}>Контекст недоступен.</p>;
  const ctx = contextQuery.data;

  return (
    <div className={styles.context}>
      <h4 className={styles.contextTitle}>
        Контекст объекта «{projectName}» на {formatDate(ctx.cutoff)}
      </h4>
      {ctx.currentState.length > 0 && (
        <p className={styles.muted}>
          Состояние по действительной дате:{' '}
          {ctx.currentState
            .map(s => `${s.building ? `${s.building}: ` : ''}${CONTEXT_STATE_LABELS[s.state] ?? s.state} с ${formatDate(s.validFrom)}`)
            .join('; ')}
        </p>
      )}
      <ul className={styles.list}>
        {ctx.participations.map(p => (
          <li key={p.assertionId}>
            {p.polarity === 'negative' ? 'не ' : ''}
            {ASSERTION_ROLE_LABELS[p.role ?? ''] ?? p.role}
            {p.building && `, ${p.building}`}
            {p.workPackage && `, ${p.workPackage}`} — {period(p.validFrom, p.validTo, p.periodPrecision)}
            <span className={styles.meta}>
              {' '}
              · {MODALITY_LABELS[p.modality] ?? p.modality} · {REVIEW_LEVEL_LABELS[p.review]}
              {!p.counted && ' · не учитывается как участие'}
            </span>
          </li>
        ))}
      </ul>
      {ctx.projectEvents.length === 0 ? (
        <p className={styles.muted}>Событий объекта в собранной выборке не найдено.</p>
      ) : (
        <ul className={styles.list}>
          {ctx.projectEvents.map(e => (
            <li key={e.assertionId}>
              По сообщению источника: {EVENT_LABELS[e.type ?? ''] ?? e.type}
              {e.building && `, ${e.building}`} — {period(e.validFrom, e.validTo, e.periodPrecision)}
              <span className={styles.meta}>
                {' '}
                · {OVERLAP_LABELS[e.overlap]}
                {e.sameBuilding === false && ' · другой корпус'}
                {e.sameBuilding === true && ' · тот же корпус'}
                {e.namesCompany ? ' · компания названа в сообщении' : ' · компания в сообщении не названа'} ·{' '}
                {REVIEW_LEVEL_LABELS[e.review]}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.note}>{ctx.note}</p>
    </div>
  );
};
