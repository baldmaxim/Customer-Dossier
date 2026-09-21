import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../../api/client';
import type { IRunPage, RunStatus } from '../../api/types';
import { describeLoadError } from '../../lib/loadError';
import { CANDIDATE_SET_STATUS_LABELS, RUN_STATUS_LABELS, formatDateTime } from '../../lib/labels';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Section';
import { TableScroll } from '../../components/ui/TableScroll';
import styles from '../Dossier.module.css';

const PAGE = 50;
const STATUSES: RunStatus[] = ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'];

interface IFilters {
  status: '' | RunStatus;
  sourceId: string;
  revisionId: string;
  schemaVersion: string;
  fingerprint: string;
}

const EMPTY: IFilters = { status: '', sourceId: '', revisionId: '', schemaVersion: '', fingerprint: '' };

/**
 * Запуски нового конвейера (этап 15B): фильтры, курсорная пагинация, покрытие чанков, допуск. Ничего не запускает сам;
 * действия — в карточке запуска, по одному.
 */
export const RunsPage: FC = () => {
  const [draft, setDraft] = useState<IFilters>(EMPTY);
  const [filters, setFilters] = useState<IFilters>(EMPTY);
  const [cursors, setCursors] = useState<number[]>([]);
  const before = cursors[cursors.length - 1];

  const page = useQuery({
    queryKey: ['runs', filters, before ?? 0],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (filters.status) params.set('status', filters.status);
      if (filters.sourceId.trim()) params.set('sourceId', filters.sourceId.trim());
      if (filters.revisionId.trim()) params.set('revisionId', filters.revisionId.trim());
      if (filters.schemaVersion.trim()) params.set('schemaVersion', filters.schemaVersion.trim());
      if (filters.fingerprint.trim()) params.set('fingerprint', filters.fingerprint.trim().toLowerCase());
      if (before) params.set('beforeId', String(before));
      return api.get<IRunPage>(`/api/reprocess/runs?${params.toString()}`);
    },
  });
  const data = page.data;
  const field = (key: keyof IFilters, label: string, inputMode?: 'numeric') => (
    <label className={styles.field}>
      <span>{label}</span>
      <input value={draft[key]} inputMode={inputMode} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Запуски разбора</h1>
        <p className={styles.meta}>
          Почему текст не попал в досье: покрытие чанков, отказы модели и проверки, допуск источника. Канон меняется только
          публикацией набора после предпросмотра.
        </p>
        {data && (
          <p className={data.worker.pipelineEnabled ? styles.meta : styles.warn}>
            {data.worker.pipelineEnabled
              ? 'Фоновый исполнитель включён (PIPELINE_ENABLED).'
              : 'Фоновый исполнитель выключен (PIPELINE_ENABLED=false): поставленные запуски выполнит только `npm run pipeline:once`.'}{' '}
            Автопубликация: {data.worker.autoPublish ? 'включена' : 'выключена'}.
          </p>
        )}
      </header>

      <form
        className={styles.form}
        onSubmit={e => {
          e.preventDefault();
          setFilters(draft);
          setCursors([]);
        }}
      >
        <div className={styles.row}>
          <label className={styles.field}>
            <span>Статус</span>
            <select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as IFilters['status'] })}>
              <option value="">все</option>
              {STATUSES.map(s => (
                <option key={s} value={s}>
                  {RUN_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          {field('sourceId', 'Источник #', 'numeric')}
          {field('revisionId', 'Редакция #', 'numeric')}
          {field('schemaVersion', 'Схема')}
          {field('fingerprint', 'Отпечаток (начало)')}
        </div>
        <div className={styles.row}>
          <Button type="submit" variant="primary" hint="применить фильтры и начать с первой страницы">
            Показать
          </Button>
          <Button
            hint="вернуть все фильтры к значениям по умолчанию"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
              setCursors([]);
            }}
          >
            Сбросить
          </Button>
        </div>
      </form>

      <section className={styles.section}>
        {page.isLoading && <p className={styles.meta}>Загрузка…</p>}
        {page.isError && (
          <p className={styles.error} role="alert">
            {describeLoadError(page.error)}
          </p>
        )}
        {data && (
          <p className={styles.meta}>
            Всего по фильтру: {data.total}; страница {cursors.length + 1}, на ней {data.items.length}
          </p>
        )}
        {data && data.items.length === 0 && <EmptyState>Запусков по фильтру нет.</EmptyState>}
        <TableScroll minWidth={980}>
          <thead>
            <tr>
              <th>Запуск</th>
              <th>Статус</th>
              <th>Редакция</th>
              <th>Покрытие</th>
              <th>Модель / схема</th>
              <th>Допуск ИИ</th>
              <th>Набор</th>
              <th>Время</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map(r => (
              <tr key={r.id}>
                <td>
                  <Link to={`/admin/process/${r.id}`}>#{r.id}</Link>
                  {r.previousRunId !== null && <span className={styles.meta}> ← #{r.previousRunId}</span>}
                </td>
                <td>
                  {RUN_STATUS_LABELS[r.status] ?? r.status}
                  {r.error && <span className={styles.meta}> · {r.error}</span>}
                </td>
                <td>
                  №{r.revisionNo}
                  {r.latestRevisionNo > r.revisionNo && <span className={styles.warn}> (есть №{r.latestRevisionNo})</span>}
                  <span className={styles.meta}> · {r.source.key}</span>
                </td>
                <td>
                  чанков {r.coverage.chunksOk}/{r.coverage.chunks}
                  {r.coverage.chunksFailed > 0 && <span className={styles.warn}> · сбой {r.coverage.chunksFailed}</span>}
                  <span className={styles.meta}>
                    {' '}
                    · символов {r.coverage.coveredChars ?? '—'}/{r.coverage.totalChars ?? '—'}
                  </span>
                </td>
                <td>
                  {r.model ?? 'неизвестно'} · {r.schemaVersion ?? 'схема неизвестна'}
                  <span className={styles.meta}> · {r.fingerprint.slice(0, 10)}</span>
                </td>
                <td>{r.policy.allowed ? 'действует' : `нет: ${r.policy.reason ?? 'не подтверждён'}`}</td>
                <td>{r.candidateSet ? `#${r.candidateSet.id} · ${CANDIDATE_SET_STATUS_LABELS[r.candidateSet.status] ?? r.candidateSet.status}` : '—'}</td>
                <td>
                  {formatDateTime(r.createdAt)}
                  {r.usage.latencyMs !== null ? <span className={styles.meta}> · {Math.round(r.usage.latencyMs / 1000)} с</span> : <span className={styles.meta}> · время неизвестно</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
        <div className={styles.row}>
          <Button disabled={cursors.length === 0} onClick={() => setCursors(cursors.slice(0, -1))}>
            Назад
          </Button>
          <Button
            disabled={!data?.nextBeforeId}
            hint="следующая страница: список идёт от новых запусков к старым"
            onClick={() => data?.nextBeforeId && setCursors([...cursors, data.nextBeforeId])}
          >
            Дальше
          </Button>
        </div>
      </section>
    </div>
  );
};
