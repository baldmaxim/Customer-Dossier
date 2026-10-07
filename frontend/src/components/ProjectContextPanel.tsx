// Контекст объекта для участия компании (окно «Контекст объекта»): её роли на объекте и события объекта
// с пересечением периодов. Событие объекта — контекст участия, а не вина компании: вывода здесь нет.
// Название объекта — в заголовке окна, здесь не повторяется.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IProjectContext } from '../api/types';
import { CONTEXT_STATE_LABELS, EVENT_LABELS, MODALITY_LABELS, OVERLAP_LABELS, REVIEW_LEVEL_LABELS, formatDate, roleLabel } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { formatPeriod } from '../lib/period';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Heading } from './ui/Heading';
import { Loading } from './ui/Loading';
import styles from './ProjectContextPanel.module.css';

interface IProjectContextPanelProps {
  companyId: number;
  projectId: number;
}

const periodText = (from: string | null, to: string | null, precision: string): string => formatPeriod(from, to, precision) || 'период неизвестен';

export const ProjectContextPanel: FC<IProjectContextPanelProps> = ({ companyId, projectId }) => {
  const contextQuery = useQuery({
    queryKey: ['company', companyId, 'context', projectId],
    queryFn: () => api.get<IProjectContext>(`/api/companies/${companyId}/context?projectId=${projectId}`),
  });
  if (contextQuery.isLoading) return <Loading label="Загружаю контекст объекта…" />;
  if (contextQuery.isError || !contextQuery.data) {
    return (
      <Callout
        tone="danger"
        title="Контекст объекта не загрузился"
        action={
          <Button size="sm" onClick={() => void contextQuery.refetch()}>
            Повторить
          </Button>
        }
      >
        {describeLoadError(contextQuery.error)}
      </Callout>
    );
  }
  const ctx = contextQuery.data;

  return (
    <div className={styles.context}>
      <p className={styles.note}>Сведения на {formatDate(ctx.cutoff)}</p>
      {ctx.currentState.length > 0 && (
        <p className={styles.line}>
          Состояние (по дате события):{' '}
          {ctx.currentState
            .map(s => `${s.building ? `${s.building}: ` : ''}${CONTEXT_STATE_LABELS[s.state] ?? 'состояние не названо'} с ${formatDate(s.validFrom)}`)
            .join('; ')}
        </p>
      )}
      {ctx.participations.length > 0 && (
        <>
          <Heading className={styles.title}>Роли компании на объекте</Heading>
          <ul className={styles.list}>
            {ctx.participations.map(p => (
              <li key={p.assertionId}>
                {p.polarity === 'negative' ? 'не ' : ''}
                {roleLabel(p.role)}
                {p.building && `, ${p.building}`}
                {p.workPackage && `, ${p.workPackage}`} — {periodText(p.validFrom, p.validTo, p.periodPrecision)}
                <span className={styles.meta}>
                  {' · '}
                  {MODALITY_LABELS[p.modality] ?? MODALITY_LABELS.unknown} · {REVIEW_LEVEL_LABELS[p.review] ?? ''}
                  {!p.counted && ' · не учитывается как участие'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Heading className={styles.title}>События объекта</Heading>
      {ctx.projectEvents.length === 0 ? (
        <p className={styles.line}>Событий объекта в собранных публикациях не найдено.</p>
      ) : (
        <ul className={styles.list}>
          {ctx.projectEvents.map(e => (
            <li key={e.assertionId}>
              По сообщению источника: {EVENT_LABELS[e.type ?? ''] ?? EVENT_LABELS.other}
              {e.building && `, ${e.building}`} — {periodText(e.validFrom, e.validTo, e.periodPrecision)}
              <span className={styles.meta}>
                {' · '}
                {OVERLAP_LABELS[e.overlap] ?? ''}
                {e.sameBuilding === false && ' · другой корпус'}
                {e.sameBuilding === true && ' · тот же корпус'}
                {e.namesCompany ? ' · компания названа в сообщении' : ' · компания в сообщении не названа'} · {REVIEW_LEVEL_LABELS[e.review] ?? ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.note}>{ctx.note}</p>
    </div>
  );
};
