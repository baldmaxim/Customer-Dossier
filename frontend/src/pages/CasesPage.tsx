import { FC, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import type { ICaseInput, ICaseRow } from '../api/types';
import { CaseForm } from '../components/CaseForm';
import { formatDate } from '../lib/labels';
import styles from './Dossier.module.css';

const newKey = (): string => `case-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Обращения: список и новое обращение. Ключ идемпотентности защищает от двойной отправки. */
export const CasesPage: FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const presetId = Number(params.get('companyId'));
  const preset = useMemo(
    () => (Number.isSafeInteger(presetId) && presetId > 0 ? { companyId: presetId, companyName: params.get('companyName') ?? `#${presetId}` } : null),
    [presetId, params],
  );
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);

  const list = useInfiniteQuery({
    queryKey: ['cases', status],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ limit: '30' });
      if (status !== 'all') search.set('status', status);
      if (pageParam) search.set('before', String(pageParam));
      return api.get<{ items: ICaseRow[]; nextBefore: number | null }>(`/api/cases?${search}`);
    },
    getNextPageParam: last => last.nextBefore,
  });

  const create = useMutation({
    mutationFn: (input: ICaseInput) => api.post<{ case: ICaseRow }>('/api/cases', { ...input, idempotencyKey }),
    onSuccess: result => {
      setIdempotencyKey(newKey());
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate(`/cases/${result.case.id}`);
    },
  });

  const items = list.data?.pages.flatMap(p => p.items) ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Обращения</h1>
        <p className={styles.meta}>Предмет обращения, заявленная роль и вопросы контрагенту. Записи оператора не меняют сведения из источников.</p>
        <div className={styles.row}>
          <button type="button" className={styles.buttonPrimary} onClick={() => setCreating(!creating)} aria-expanded={creating}>
            {creating ? 'Скрыть форму' : 'Новое обращение'}
          </button>
          <label className={styles.field}>
            <span className={styles.hint}>Статус</span>
            <select value={status} onChange={e => setStatus(e.target.value as 'open' | 'closed' | 'all')}>
              <option value="open">открытые</option>
              <option value="closed">закрытые</option>
              <option value="all">все</option>
            </select>
          </label>
        </div>
      </header>

      {creating && (
        <section className={styles.section} aria-label="Новое обращение">
          <CaseForm
            preset={preset}
            pending={create.isPending}
            error={create.error ? (create.error instanceof ApiError ? create.error.message : 'Не удалось сохранить') : null}
            submitLabel="Сохранить обращение"
            onSubmit={input => create.mutate(input)}
          />
        </section>
      )}

      <section className={styles.section}>
        {list.isLoading && <p className={styles.meta}>Загрузка…</p>}
        {list.isError && <p className={styles.error}>Список недоступен: {(list.error as Error).message}</p>}
        {list.isSuccess && items.length === 0 && <p className={styles.meta}>Обращений нет.</p>}
        <ul className={styles.list}>
          {items.map(c => (
            <li key={c.id} className={styles.listItem}>
              <Link to={`/cases/${c.id}`}>
                <strong>{c.title}</strong>
              </Link>
              <p className={styles.meta}>
                {c.companyStatus === 'identified' ? c.companyName : `юрлицо не установлено («${c.companyNameClaimed}»)`}
                {c.projectName && ` · ${c.projectName}`}
                {c.scopeBuilding && `, ${c.scopeBuilding}`} · от {formatDate(c.requestDate)} · {c.status === 'open' ? 'открыто' : 'закрыто'} · версия {c.version}
              </p>
            </li>
          ))}
        </ul>
        {list.hasNextPage && (
          <button type="button" className={styles.button} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {list.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
          </button>
        )}
      </section>
    </div>
  );
};
