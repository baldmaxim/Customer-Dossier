// Объект: шапка (уровень, родитель, город, очереди), паспорт ДОМ.РФ первым (02.10.2026) — или
// словами, что его нет, и похожие объекты со сведениями; состояние по событиям, участники с «Откуда
// известно» у строки; остальное — разделами, где есть что показать, раскрытыми. Период — в адресе.
// С 1280px паспорт — колонкой справа, участники и разделы — слева (05.10.2026: одной колонкой на широком
// экране паспорт с фото отодвигал участников на второй экран). Порядок в разметке прежний — паспорт первым.

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
            К компаниям
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
      <div className={d.registry ? styles.layout : styles.layoutSingle}>
        <div className={styles.layoutAside}>
          {d.registry ? <ProjectPassport registry={d.registry} projectId={d.project.id} name={d.project.name} /> : <ProjectRegistryMissing dossier={d} />}
        </div>
        <div className={styles.layoutMain}>
          {/* Статус объекта — одно правило с карточкой во вкладке «Объекты» (lib/registrySummary.ts): сведения ДОМ.РФ, а
              без них — состояние по событиям. При паспорте события состояния — в «Истории состояния», не второй строкой статуса. */}
          {!d.registry && <ProjectStateLine state={d.state} />}
          <ProjectParticipants dossier={d} period={period} onPeriodChange={changePeriod} busy={query.isFetching && query.isPlaceholderData} />
          <ProjectSections dossier={d} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ProjectHeader dossier={d} state={missing ? 'missing' : d ? 'ready' : query.isError ? 'error' : 'loading'} />
      {body}
    </div>
  );
};
