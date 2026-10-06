// «Где тексты сейчас» — по последним версиям текстов: каждое состояние отвечает на вопрос
// «почему текста нет в карточках». Состояния, которые сводятся к разборам (в очереди, не удался,
// разобран и не перенесён, отменён), — кнопки-фильтры списка ниже по тому же правилу, что счётчик
// (`?state=`): раньше «попытки исчерпаны» и «будет повтор» открывали один список всех упавших
// запусков за всё время, и число в нём не совпадало ни с одной плиткой.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingSkeleton } from '../LoadingSkeleton';
import { api } from '../../api/client';
import type { IPipelineOverview, RunListState } from '../../api/types';
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

/** Состояния, по которым список разборов фильтруется (RUN_LIST_STATES на сервере). */
export const RUN_LIST_STATES: readonly RunListState[] = [
  'failed_exhausted',
  'failed_retrying',
  'completed_unpublished',
  'in_queue',
  'cancelled',
];
const isListState = (state: string): state is RunListState => (RUN_LIST_STATES as readonly string[]).includes(state);

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
  state: RunListState | '';
  onFilter: (state: RunListState | '') => void;
}

export const RevisionStates: FC<IRevisionStatesProps> = ({ state, onFilter }) => {
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
            const filter = isListState(s.state) ? s.state : null;
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
                    aria-pressed={state === filter}
                    hint={state === filter ? 'Показать все разборы' : 'Показать эти тексты в списке ниже — по последнему разбору каждого'}
                    onClick={() => onFilter(state === filter ? '' : filter)}
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
