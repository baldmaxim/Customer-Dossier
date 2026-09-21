// Обзор конвейера: три ступени и честное состояние каждой.
//
// Три состояния различаются словами, а не цветом: «выключено оператором» —
// это решение, «сломано» — сбой, «не запускался» — отсутствие данных.
// Итоговой оценки и сортировки «по риску» здесь нет и не будет (ADR-009).

import { FC, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../../api/client';
import type { IPipelineOverview, IRunPage, ISourceRow, ISummaryResponse } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Section } from '../../components/ui/Section';
import { DOCUMENT_STATUS_LABELS, RUN_STATUS_LABELS, SOURCE_HEALTH_STATE_LABELS, formatDateTime } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import styles from './PipelinePage.module.css';

const Row: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className={styles.row}>
    <span className={styles.rowLabel}>{label}</span>
    <span className={styles.rowValue}>{children}</span>
  </div>
);

/** Флаг фонового задания: выключен — это решение оператора, а не поломка. */
const FlagBadge: FC<{ on: boolean; label: string; envKey: string; hintOff: string }> = ({ on, label, envKey, hintOff }) => (
  <Badge tone={on ? 'positive' : 'neutral'} hint={on ? `включено (${envKey}=true)` : hintOff}>
    {label}: {on ? 'включено' : 'выключено'}
  </Badge>
);

export const PipelinePage: FC = () => {
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ items: ISourceRow[] }>('/api/admin/sources'),
  });
  const pipeline = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api.get<IPipelineOverview>('/api/admin/pipeline'),
  });
  const runs = useQuery({
    queryKey: ['runs', 'overview'],
    queryFn: () => api.get<IRunPage>('/api/reprocess/runs?limit=5'),
  });
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<ISummaryResponse>('/api/contractors/summary'),
  });

  const items = sources.data?.items ?? [];
  const byHealth = items.reduce<Record<string, number>>((acc, s) => {
    const state = s.healthState?.state ?? 'never_run';
    acc[state] = (acc[state] ?? 0) + 1;
    return acc;
  }, {});
  const collectApproved = items.filter(s => s.collectBlockedReason === null).length;
  const aiApproved = items.filter(s => s.aiBlockedReason === null).length;
  const worker = pipeline.data?.worker;
  const queued = pipeline.data?.queue ?? [];
  const totals = summary.data?.totals;
  const refresh = summary.data?.refresh;

  return (
    <>
      {worker && (
        <div className={styles.flags}>
          <FlagBadge
            on={worker.ingestEnabled}
            label="Сбор"
            envKey="INGEST_ENABLED"
            hintOff="выключено оператором (INGEST_ENABLED=false); разовый проход — npm run ingest:once"
          />
          <FlagBadge
            on={worker.pipelineEnabled}
            label="Разбор"
            envKey="PIPELINE_ENABLED"
            hintOff="выключено оператором (PIPELINE_ENABLED=false); поставленные запуски выполнит npm run pipeline:once"
          />
          <FlagBadge
            on={worker.autoPublish}
            label="Результат в карточки"
            envKey="REPROCESS_AUTO_PUBLISH"
            hintOff="разобранное остаётся набором кандидатов и в карточки не идёт (REPROCESS_AUTO_PUBLISH=false)"
          />
          <FlagBadge
            on={worker.metricsAutoRefresh}
            label="Пересчёт сигналов"
            envKey="METRICS_AUTO_REFRESH"
            hintOff="выключено оператором (METRICS_AUTO_REFRESH=false); срез считает npm run metrics:refresh"
          />
        </div>
      )}

      <div className={styles.stages}>
        <Section title="Сбор" note={<span className={styles.stageNo}>ступень 1</span>} className={styles.stage}>
          {sources.isError ? (
            <p className={styles.note} role="alert">
              {describeLoadError(sources.error)}
            </p>
          ) : (
            <>
              <div className={styles.rows}>
                <Row label="Источников всего">{items.length}</Row>
                <Row label="Допущено к сбору">{collectApproved}</Row>
                <Row label="Допущено к ИИ-обработке">{aiApproved}</Row>
                {Object.entries(byHealth).map(([state, n]) => (
                  <Row key={state} label={SOURCE_HEALTH_STATE_LABELS[state] ?? state}>
                    {n}
                  </Row>
                ))}
              </div>
              <p className={styles.note}>
                Допуск ставит оператор с основанием. «Не запускался» — это не «пусто» и не «сломано».
              </p>
              <Link to="/admin/collect">Источники и ручная вставка →</Link>
            </>
          )}
        </Section>

        <Section title="Обработка" note={<span className={styles.stageNo}>ступень 2</span>} className={styles.stage}>
          {pipeline.isError ? (
            <p className={styles.note} role="alert">
              {describeLoadError(pipeline.error)}
            </p>
          ) : (
            <>
              <div className={styles.rows}>
                {queued.length === 0 && <Row label="Документов в очереди">0</Row>}
                {queued.map(q => (
                  <Row key={q.status} label={DOCUMENT_STATUS_LABELS[q.status] ?? q.status}>
                    {q.n}
                  </Row>
                ))}
                <Row label="Запусков в выборке">{runs.data?.total ?? '—'}</Row>
              </div>
              <p className={styles.note}>
                Последние запуски:{' '}
                {(runs.data?.items ?? []).length === 0
                  ? 'нет'
                  : (runs.data?.items ?? []).map(r => `#${r.id} — ${RUN_STATUS_LABELS[r.status] ?? r.status}`).join(', ')}
              </p>
              <Link to="/admin/process">Запуски разбора →</Link>
            </>
          )}
        </Section>

        <Section title="Результат" note={<span className={styles.stageNo}>ступень 3</span>} className={styles.stage}>
          {summary.isError ? (
            <p className={styles.note} role="alert">
              {describeLoadError(summary.error)}
            </p>
          ) : (
            <>
              <div className={styles.rows}>
                <Row label="Компаний">{totals?.companies ?? '—'}</Row>
                <Row label="Объектов">{totals?.projects ?? '—'}</Row>
                <Row label="Разобранных сообщений">{totals?.documents ?? '—'}</Row>
                <Row label="Пар ждут слияния">{totals?.pendingMerges ?? '—'}</Row>
              </div>
              <p className={styles.note}>
                {refresh?.active
                  ? `Снимок сигналов №${refresh.active.id} на срез ${formatDateTime(refresh.active.cutoffAt)}${refresh.stale ? ' — устарел' : ''}.`
                  : 'Снимок сигналов не рассчитан: каталог компаний будет пуст, пока не выполнен npm run metrics:refresh.'}
              </p>
              <Link to="/admin/result">Что в базе и качество связей →</Link>
            </>
          )}
        </Section>
      </div>
    </>
  );
};
