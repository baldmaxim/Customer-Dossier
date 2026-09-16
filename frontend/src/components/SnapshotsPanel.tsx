import { FC, FormEvent, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { ISnapshotListItem } from '../api/types';
import { formatDateTime } from '../lib/labels';
import styles from '../pages/Dossier.module.css';

const newKey = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * Снимки досье обращения: неизменяемая копия того, что известно сейчас. Фильтр дат ограничивает события и роли,
 * но не делает снимок документом прошлого. Повторное нажатие не создаёт дубль (ключ идемпотентности на форму).
 */
export const SnapshotsPanel: FC<{ caseId: number }> = ({ caseId }) => {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const keyRef = useRef(newKey());

  const list = useQuery({ queryKey: ['case', caseId, 'snapshots'], queryFn: () => api.get<{ items: ISnapshotListItem[] }>(`/api/cases/${caseId}/snapshots`) });

  const create = useMutation({
    mutationFn: () => api.post<{ id: number; replayed: boolean }>(`/api/cases/${caseId}/snapshots`, { effectiveFrom: from || null, effectiveTo: to || null, idempotencyKey: keyRef.current }),
    onSuccess: () => {
      keyRef.current = newKey();
      void queryClient.invalidateQueries({ queryKey: ['case', caseId, 'snapshots'] });
    },
  });

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <section className={styles.section} aria-labelledby="snapshots">
      <h2 id="snapshots" className={styles.sectionTitle}>Снимки досье</h2>
      <p className={styles.meta}>Снимок фиксирует досье, цитаты, решения и схему на текущий момент и дальше не меняется. Выгрузки строятся из снимка.</p>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          События и роли с (необязательно)
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className={styles.field}>
          по
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </label>
        <p className={`${styles.hint} ${styles.full}`}>Фильтр дат — не срез знаний на прошлую дату: используются сведения, известные сейчас.</p>
        <div className={`${styles.row} ${styles.full}`}>
          <button type="submit" className={styles.buttonPrimary} disabled={create.isPending || Boolean(from && to && to < from)}>
            {create.isPending ? 'Создаю…' : 'Создать снимок'}
          </button>
          {create.isError && (
            <span className={styles.error} role="alert">
              {(create.error as Error).message}
            </span>
          )}
          {create.data && (
            <span className={styles.meta} role="status">
              {create.data.replayed ? 'Снимок уже создан этим запросом' : 'Снимок создан'}: <Link to={`/snapshots/${create.data.id}`}>№{create.data.id}</Link>
            </span>
          )}
        </div>
      </form>

      {list.isError && (
        <p className={styles.error} role="alert">
          Список снимков недоступен: {(list.error as Error).message}
        </p>
      )}
      {list.data && list.data.items.length === 0 && <p className={styles.meta}>Снимков пока нет.</p>}
      {list.data && list.data.items.length > 0 && (
        <ul className={styles.list}>
          {list.data.items.map(s => (
            <li key={s.id} className={styles.listItem}>
              <Link to={`/snapshots/${s.id}`}>Снимок №{s.id}</Link> · {formatDateTime(s.generatedAt)} · версия обращения {s.caseVersion}
              {(s.effectiveFrom || s.effectiveTo) && ` · события ${s.effectiveFrom ?? '…'} — ${s.effectiveTo ?? '…'}`}
              {s.redactions > 0 && ` · вымарано фрагментов: ${s.redactions}`}
              <span className={styles.quoteMeta}>
                {s.templateVersion}, {s.rulesVersion} · hash {s.payloadHash.slice(0, 12)}…
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
