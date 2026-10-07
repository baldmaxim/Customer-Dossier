// Разбор одного текста — только чтение: итог одной фразой, сам текст, что найдено и что
// попало в карточки. Номера, модель, отпечаток, части текста — под «Техническими подробностями».
// Обработка идёт сама, запускать и отменять её отсюда нечем; восстановление после сбоя — CLI.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { ApiError, api } from '../../api/client';
import type { IRevision, IRunDetail, ISourceRow } from '../../api/types';
import { RunCandidates } from '../../components/admin/RunCandidates';
import { outcomeOf, outcomeSentence } from '../../components/admin/runOutcome';
import { RunOutcomeBadge } from '../../components/admin/RunOutcomeBadge';
import { runDuration } from '../../components/admin/RunsList';
import { RunTechDetails } from '../../components/admin/RunTechDetails';
import { CandidateSetPanel } from '../../components/CandidateSetPanel';
import { TelegramPost } from '../../components/TelegramPost';
import { Button } from '../../components/ui/Button';
import { ButtonLink } from '../../components/ui/ButtonLink';
import { Callout } from '../../components/ui/Callout';
import { Cluster } from '../../components/ui/Cluster';
import { Disclosure } from '../../components/ui/Disclosure';
import { HeadingLevelContext } from '../../components/ui/headingLevel';
import { Loading } from '../../components/ui/Loading';
import { PageHeader } from '../../components/ui/PageHeader';
import { Section } from '../../components/ui/Section';
import { Stack } from '../../components/ui/Stack';
import { formatDuration } from '../../lib/format';
import { formatDateTime, sourceLabel } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import styles from './RunPage.module.css';

const EYEBROW = 'Админка · Обработка';

export const RunPage: FC = () => {
  const { id } = useParams();
  const runId = Number(id);
  const valid = Number.isSafeInteger(runId) && runId > 0;

  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.get<IRunDetail>(`/api/reprocess/runs/${runId}`),
    enabled: valid,
  });
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ items: ISourceRow[] }>('/api/admin/sources'),
    enabled: valid,
  });
  const revisionId = run.data?.revision?.id ?? null;
  // Тот же запрос и ключ, что у поста: одна загрузка текста, а отсюда — момент, когда портал его увидел.
  const revision = useQuery({
    queryKey: ['revision', revisionId],
    queryFn: () => api.get<{ revision: IRevision }>(`/api/revisions/${revisionId}`),
    enabled: revisionId !== null,
  });

  if (!valid) {
    return (
      <Stack gap={4}>
        <PageHeader eyebrow={EYEBROW} title="Разбор не найден" />
        <p className={styles.text}>В адресе нет номера разбора.</p>
        <div>
          <ButtonLink to="/admin/process">К разборам</ButtonLink>
        </div>
      </Stack>
    );
  }
  if (run.isLoading) {
    return (
      <Stack gap={4}>
        <PageHeader eyebrow={EYEBROW} title="Разбор" />
        <LoadingSkeleton label="Загружаю разбор…" lines={6} height="44px" />
      </Stack>
    );
  }
  if (run.isError || !run.data?.revision) {
    const missing = run.error instanceof ApiError && run.error.status === 404;
    return (
      <Stack gap={4}>
        <PageHeader eyebrow={EYEBROW} title={missing ? 'Разбор не найден' : 'Разбор'} />
        <Callout
          tone="danger"
          title={missing ? 'Такого разбора нет' : 'Разбор не загрузился'}
          action={
            missing ? (
              <ButtonLink to="/admin/process">К разборам</ButtonLink>
            ) : (
              <Button onClick={() => void run.refetch()}>Повторить</Button>
            )
          }
        >
          {describeLoadError(run.error)}
        </Callout>
      </Stack>
    );
  }

  const r = run.data;
  const source = sources.data?.items.find(s => s.id === r.source.id);
  const name = source ? sourceLabel({ sourceTitle: source.title, sourceKey: source.key, sourceKind: source.kind }) : r.source.key;
  const outcome = outcomeOf(r);
  const pendingLatest = r.latestRevision !== null && r.latestRevision.no > r.revision.no;
  const title = `Разбор от ${formatDateTime(r.createdAt)}`;
  const current = r.publication.activeSetId === null ? 'none' : r.publication.activeRunId === r.id ? 'this' : 'other';

  return (
    <Stack gap={4}>
      <PageHeader
        eyebrow={EYEBROW}
        title={title}
        meta={
          <Cluster gap={[1, 3]}>
            <RunOutcomeBadge run={r} />
            <span>{name}</span>
            {r.revision.publishedAt && <span>текст от {formatDateTime(r.revision.publishedAt)}</span>}
            {runDuration(r) !== null && <span>длился {formatDuration(runDuration(r))}</span>}
          </Cluster>
        }
        lead={outcomeSentence(outcome)}
      />

      {r.error && (outcome.state === 'failed' || outcome.state === 'partial') && (
        <Callout tone="warning" title="Что пошло не так">
          {r.error}
        </Callout>
      )}
      {!r.policy.allowed && (
        <Callout tone="neutral">Источник выключен — текст не разбирается{r.policy.reason ? `: ${r.policy.reason}` : ''}.</Callout>
      )}
      {pendingLatest && <Callout tone="info">Текст изменился после этого разбора; портал разберёт новую версию сам.</Callout>}
      {r.inFlight && <Callout tone="info">Разбор выполняется: запрос к модели отправлен, ответ ещё не пришёл.</Callout>}

      <Section title="Текст">
        {sources.isLoading ? (
          <Loading label="Загружаю текст…" />
        ) : (
          <TelegramPost
            revisionId={r.revision.id}
            sourceTitle={source?.title ?? r.source.key}
            sourceKey={r.source.key}
            sourceKind={source?.kind ?? 'website'}
            publishedAt={r.revision.publishedAt}
            observedAt={revision.data?.revision.firstObservedAt ?? r.createdAt}
            url={null}
            title={r.revision.title}
          />
        )}
      </Section>

      <Section title="Что найдено в тексте">
        <RunCandidates candidates={r.candidates} ambiguities={r.ambiguities} />
      </Section>

      <Section title="Что попало в карточки">
        <Stack gap={3}>
          <p className={styles.text}>
            {current === 'none' && 'Сейчас из этого текста в карточках ничего нет.'}
            {current === 'this' && 'Сейчас в карточках — сведения этого разбора.'}
            {current === 'other' && (
              <>
                Сейчас в карточках — сведения другого разбора этого текста.{' '}
                {r.publication.activeRunId !== null && (
                  <Link to={`/admin/process/${r.publication.activeRunId}`} viewTransition>
                    Открыть тот разбор
                  </Link>
                )}
              </>
            )}
          </p>
          {r.candidateSet ? (
            <CandidateSetPanel setId={r.candidateSet.id} />
          ) : (
            <p className={styles.text}>
              {outcome.state === 'not_relevant'
                ? 'Текст не о стройке — переносить нечего.'
                : !r.policy.allowed
                  ? 'Ничего не перенесено: источник выключен.'
                  : 'Ничего не перенесено: текст разобран не полностью или разбор ещё идёт.'}
            </p>
          )}
        </Stack>
      </Section>

      <Disclosure variant="card" level={2} summary="Технические подробности">
        <HeadingLevelContext.Provider value={3}>
          <RunTechDetails run={r} />
        </HeadingLevelContext.Provider>
      </Disclosure>
    </Stack>
  );
};
