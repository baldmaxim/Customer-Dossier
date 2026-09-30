// «Где тексты сейчас» — по последним версиям текстов: каждое состояние отвечает на вопрос
// «почему текста нет в карточках». Состояния, которые сводятся к статусу разбора (в очереди,
// не удался, отменён), — кнопки-фильтры списка разборов ниже: раньше счётчики никуда не вели.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingSkeleton } from '../LoadingSkeleton';
import { api } from '../../api/client';
import type { IPipelineOverview, RunStatus } from '../../api/types';
import { formatCount } from '../../lib/format';
import { REVISION_STATE_LABELS } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { REVISION_STATE_TONE, toneOf } from '../../lib/statusTone';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Disclosure } from '../ui/Disclosure';
import { EmptyState } from '../ui/EmptyState';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import styles from './Runs.module.css';

/** Состояние текста → статус разбора, которым его можно отфильтровать. */
const STATE_FILTER: Partial<Record<string, RunStatus>> = {
  in_queue: 'queued',
  failed_retrying: 'failed',
  failed_exhausted: 'failed',
  cancelled: 'cancelled',
};

/** Сначала то, что требует внимания, затем штатные исходы. */
const ORDER = [
  'failed_exhausted',
  'failed_retrying',
  'completed_unpublished',
  'in_queue',
  'waiting',
  'no_ai_permission',
  'cancelled',
  'irrelevant',
  'published',
  'unknown',
];

interface IRevisionStatesProps {
  status: RunStatus | '';
  onFilter: (status: RunStatus | '') => void;
}

export const RevisionStates: FC<IRevisionStatesProps> = ({ status, onFilter }) => {
  const pipeline = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api.get<IPipelineOverview>('/api/admin/pipeline'),
  });

  const body = (() => {
    if (pipeline.isLoading) {
      return (
        <LoadingSkeleton label="Считаю тексты…" lines={2} height="64px" />
      );
    }
    if (pipeline.isError) {
      return (
        <Callout tone="danger" title="Счётчики не получены" action={<Button onClick={() => void pipeline.refetch()}>Повторить</Button>}>
          {describeLoadError(pipeline.error)}
        </Callout>
      );
    }
    const states = [...(pipeline.data?.revisions ?? [])].sort((a, b) => {
      const ia = ORDER.indexOf(a.state);
      const ib = ORDER.indexOf(b.state);
      return (ia === -1 ? ORDER.length : ia) - (ib === -1 ? ORDER.length : ib);
    });
    if (states.length === 0) return <EmptyState size="sm">Публикаций пока нет — нечего разбирать.</EmptyState>;
    const failures = pipeline.data?.failures ?? [];

    return (
      <Stack gap={3}>
        <ul className={styles.tiles}>
          {states.map(s => {
            const label = REVISION_STATE_LABELS[s.state] ?? s.state;
            const tone = toneOf(REVISION_STATE_TONE, s.state);
            const filter = STATE_FILTER[s.state];
            const content = (
              <>
                <span className={styles.tileValue}>{formatCount(s.n)}</span>
                <span className={styles.tileLabel}>
                  <span className={styles.dot} data-tone={tone} aria-hidden="true" />
                  {label}
                </span>
              </>
            );
            return (
              <li key={s.state} className={styles.tileItem}>
                {filter ? (
                  <Button
                    variant="secondary"
                    className={styles.tile}
                    aria-pressed={status === filter}
                    hint={status === filter ? 'Показать все разборы' : 'Показать эти разборы в списке ниже'}
                    onClick={() => onFilter(status === filter ? '' : filter)}
                  >
                    {content}
                  </Button>
                ) : (
                  <div className={styles.tile}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
        {failures.length > 0 && (
          <Disclosure summary="Почему разбор не удавался за неделю" meta={formatCount(failures.reduce((n, f) => n + f.n, 0))}>
            <ul className={styles.failures}>
              {failures.map(f => (
                <li key={f.reason}>
                  {f.reason} <span className={styles.totalsMuted}>— {formatCount(f.n)}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </Stack>
    );
  })();

  return (
    <Section title="Где тексты сейчас" note="по последним версиям текстов">
      {body}
    </Section>
  );
};
