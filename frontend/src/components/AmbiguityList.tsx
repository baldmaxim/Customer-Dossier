import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { AmbiguityStatus, IAmbiguityPage } from '../api/types';
import { AMBIGUITY_STATUS_LABELS, formatDateTime } from '../lib/labels';
import styles from '../pages/Dossier.module.css';
import { AmbiguityDetail } from './AmbiguityDetail';

const PAGE = 50;

/** Неоднозначные упоминания с серверным фильтром и курсорной пагинацией; «всего» — по фильтру, а не длина страницы. */
export const AmbiguityList: FC = () => {
  const [status, setStatus] = useState<AmbiguityStatus>('open');
  const [kind, setKind] = useState<'' | 'company' | 'project'>('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const cursor = cursors[cursors.length - 1];

  const page = useQuery({
    queryKey: ['ambiguities', status, kind, cursor ?? ''],
    queryFn: () => {
      const params = new URLSearchParams({ status, limit: String(PAGE) });
      if (kind) params.set('kind', kind);
      if (cursor) params.set('cursor', cursor);
      return api.get<IAmbiguityPage>(`/api/entities/ambiguities?${params.toString()}`);
    },
  });
  const reset = (): void => {
    setCursors([]);
    setOpenId(null);
  };
  const data = page.data;

  return (
    <section className={styles.section}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Состояние</span>
          <select
            value={status}
            onChange={e => {
              setStatus(e.target.value as AmbiguityStatus);
              reset();
            }}
          >
            {(['open', 'resolved', 'dismissed'] as const).map(s => (
              <option key={s} value={s}>
                {AMBIGUITY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Сущность</span>
          <select
            value={kind}
            onChange={e => {
              setKind(e.target.value as '' | 'company' | 'project');
              reset();
            }}
          >
            <option value="">все</option>
            <option value="company">компании</option>
            <option value="project">объекты</option>
          </select>
        </label>
      </div>
      {page.isLoading && <p className={styles.meta}>Загрузка…</p>}
      {page.isError && (
        <p className={styles.error} role="alert">
          Список недоступен: {(page.error as Error).message}
        </p>
      )}
      {data && (
        <p className={styles.meta}>
          Всего: {data.total}; страница {cursors.length + 1}, на ней {data.items.length}
        </p>
      )}
      <ul className={styles.list}>
        {data?.items.map(item => (
          <li key={item.id} className={styles.listItem}>
            <div className={styles.row}>
              <strong>«{item.surface}»</strong>
              <span className={styles.meta}>
                {item.entityKind === 'company' ? 'компания' : 'объект'} · кандидатов {item.candidateIds.length} · {formatDateTime(item.updatedAt)}
              </span>
              <button type="button" className={styles.linkButton} aria-expanded={openId === item.id} onClick={() => setOpenId(openId === item.id ? null : item.id)}>
                {openId === item.id ? 'свернуть' : 'разобрать'}
              </button>
            </div>
            {openId === item.id && <AmbiguityDetail ambiguityId={item.id} />}
          </li>
        ))}
      </ul>
      <div className={styles.row}>
        <button type="button" className={styles.button} disabled={cursors.length === 0} onClick={() => setCursors(cursors.slice(0, -1))}>
          Назад
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={!data?.nextCursor}
          onClick={() => data?.nextCursor && setCursors([...cursors, data.nextCursor])}
        >
          Дальше
        </button>
      </div>
    </section>
  );
};
