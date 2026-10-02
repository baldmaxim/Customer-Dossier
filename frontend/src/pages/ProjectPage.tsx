// Объект: шапка (уровень, родитель, город, очереди), паспорт ДОМ.РФ первым (02.10.2026) — или
// словами, что его нет, и похожие объекты со сведениями; состояние по событиям, участники с «Откуда
// известно» у строки; остальное — разделами, где есть что показать, раскрытыми. Период — в адресе.

import { FC, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import type { IProjectDossier } from '../api/types';
import { Button } from '../components/ui/Button';
import { ButtonLink } from '../components/ui/ButtonLink';
import { Callout } from '../components/ui/Callout';
import { EmptyState } from '../components/ui/EmptyState';
import { Loading } from '../components/ui/Loading';
import { Skeleton } from '../components/ui/Skeleton';
import { flagParam, useUrlPatch, useUrlState, type IUrlCodec } from '../hooks/useUrlState';
import { describeLoadError } from '../lib/loadError';
import type { IPeriod } from './project/PeriodFilter';
import { ProjectHeader } from './project/ProjectHeader';
import { ProjectParticipants } from './project/ProjectParticipants';
import { ProjectPassport, ProjectRegistryMissing } from './project/ProjectPassport';
import { ProjectSections } from './project/ProjectSections';
import { ProjectStateLine } from './project/ProjectState';
import styles from './ProjectPage.module.css';

/** Дата в адресе: только ГГГГ-ММ-ДД, мусор — как отсутствие даты. */
const dateParam: IUrlCodec<string> = {
  parse: raw => (raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''),
  serialize: value => value || null,
};

export const ProjectPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const valid = Number.isSafeInteger(projectId) && projectId > 0;
  const [from] = useUrlState('from', dateParam);
  const [to] = useUrlState('to', dateParam);
  const [only] = useUrlState('only', flagParam());
  const patch = useUrlPatch();

  const query = useQuery({
    queryKey: ['project', projectId, 'dossier', from, to],
    queryFn: () => {
      const search = new URLSearchParams();
      if (from) search.set('from', from);
      if (to) search.set('to', to);
      return api.get<IProjectDossier>(`/api/projects/${projectId}/dossier?${search}`);
    },
    enabled: valid,
    // Смена периода не стирает страницу: прежний список виден приглушённым, пока идёт запрос.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === projectId ? previous : undefined),
  });

  const d = query.data;
  if (d?.project.mergedIntoId) return <Navigate to={`/projects/${d.project.mergedIntoId}`} replace />;

  const missing = !valid || (query.error instanceof ApiError && query.error.status === 404);
  const period: IPeriod = { from, to, only };
  const changePeriod = (next: Partial<IPeriod>): void => {
    const merged = { ...period, ...next };
    // Без дат «только работавшие» не имеет смысла — флажок уходит вместе с периодом.
    patch({ from: merged.from, to: merged.to, only: merged.only && Boolean(merged.from || merged.to) });
  };

  let body: ReactNode;
  if (missing) {
    body = (
      <EmptyState
        title="Такого объекта нет"
        action={
          <ButtonLink to="/" variant="primary">
            К поиску
          </ButtonLink>
        }
      >
        {valid ? 'Объект не найден: возможно, его объединили с другим или адрес устарел.' : 'В адресе нет номера объекта.'}
      </EmptyState>
    );
  } else if (!d && query.isError) {
    body = (
      <Callout tone="danger" title="Объект не загрузился" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
        {describeLoadError(query.error)}
      </Callout>
    );
  } else if (!d) {
    body = (
      <Loading label="Загружаю объект…">
        <Skeleton lines={3} height="1.2em" />
        <Skeleton height="220px" radius="md" />
      </Loading>
    );
  } else {
    body = (
      <>
        {d.registry ? <ProjectPassport registry={d.registry} projectId={d.project.id} name={d.project.name} /> : <ProjectRegistryMissing dossier={d} />}
        {/* Статус со стройки в паспорте уже есть: строка состояния по событиям — только когда ей есть что сказать. */}
        {(!d.registry || d.state.current.length > 0) && <ProjectStateLine state={d.state} />}
        <ProjectParticipants dossier={d} period={period} onPeriodChange={changePeriod} busy={query.isFetching && query.isPlaceholderData} />
        <ProjectSections dossier={d} />
      </>
    );
  }

  return (
    <div className={styles.page}>
      <ProjectHeader dossier={d} state={missing ? 'missing' : d ? 'ready' : query.isError ? 'error' : 'loading'} />
      {body}
    </div>
  );
};
