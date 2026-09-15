import { FC, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { ICompanySearchItem, IProjectSearchItem } from '../api/types';
import { ENTITY_TYPE_LABELS, IDENTIFIER_TYPE_LABELS, PROJECT_LEVEL_LABELS } from '../lib/labels';
import styles from '../pages/Dossier.module.css';

const useDebounced = (value: string, delay = 300): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

export const identifierText = (raw: string): string => {
  const [type, ...rest] = raw.split(' ');
  return `${IDENTIFIER_TYPE_LABELS[type ?? ''] ?? type} ${rest.join(' ')}`;
};

interface ICompanyPickerProps {
  label: string;
  selected: { id: number; name: string } | null;
  onSelect: (company: { id: number; name: string } | null) => void;
}

/** Выбор юрлица среди кандидатов: вид сущности, реквизиты, город и одноимённые — выбор осознанный, первая строка не подставляется. */
export const CompanyPicker: FC<ICompanyPickerProps> = ({ label, selected, onSelect }) => {
  const [input, setInput] = useState('');
  const q = useDebounced(input.trim());
  const query = useQuery({
    queryKey: ['picker', 'companies', q],
    queryFn: () => api.get<{ items: ICompanySearchItem[] }>(`/api/companies?q=${encodeURIComponent(q)}&limit=10`),
    enabled: q.length >= 2,
  });

  return (
    <div className={styles.field}>
      <span>{label}</span>
      {selected ? (
        <div className={styles.row}>
          <strong>{selected.name}</strong> <span className={styles.meta}>#{selected.id}</span>
          <button type="button" className={styles.linkButton} onClick={() => onSelect(null)}>
            выбрать другое
          </button>
        </div>
      ) : (
        <>
          <input type="search" value={input} onChange={e => setInput(e.target.value)} placeholder="Название, алиас, ИНН или ОГРН" autoComplete="off" />
          {query.isError && <span className={styles.error}>Поиск недоступен: {(query.error as Error).message}</span>}
          {query.data && query.data.items.length === 0 && <span className={styles.hint}>В базе не найдено.</span>}
          <ul className={styles.candidates}>
            {(query.data?.items ?? []).map(c => (
              <li key={c.id}>
                <button type="button" className={styles.candidate} onClick={() => onSelect({ id: c.id, name: c.name })}>
                  <strong>{c.name}</strong>
                  {c.legalForm && ` · ${c.legalForm}`}
                  {c.entityType && c.entityType !== 'unknown' && ` · ${ENTITY_TYPE_LABELS[c.entityType] ?? c.entityType}`}
                  {c.city && ` · ${c.city}`}
                  <span className={styles.quoteMeta}>
                    {c.identifiers && c.identifiers.length > 0 ? c.identifiers.map(identifierText).join(', ') : 'реквизитов нет'}
                    {c.projects !== null && c.projects !== undefined && ` · объектов в выборке: ${c.projects}`}
                    {c.matchedAlias && ` · найдено по написанию «${c.matchedAlias}»`}
                    {c.homonyms ? ` · одноимённых: ${c.homonyms} — сверьте реквизиты` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

interface IProjectPickerProps {
  selected: { id: number; name: string } | null;
  onSelect: (project: { id: number; name: string } | null) => void;
}

/** Выбор объекта: город, уровень (комплекс, очередь, корпус) и родитель — одноимённые ЖК разных городов различимы. */
export const ProjectPicker: FC<IProjectPickerProps> = ({ selected, onSelect }) => {
  const [input, setInput] = useState('');
  const q = useDebounced(input.trim());
  const query = useQuery({
    queryKey: ['picker', 'projects', q],
    queryFn: () => api.get<{ items: IProjectSearchItem[] }>(`/api/projects/search?q=${encodeURIComponent(q)}&limit=10`),
    enabled: q.length >= 2,
  });

  return (
    <div className={styles.field}>
      <span>Объект</span>
      {selected ? (
        <div className={styles.row}>
          <strong>{selected.name}</strong> <span className={styles.meta}>#{selected.id}</span>
          <button type="button" className={styles.linkButton} onClick={() => onSelect(null)}>
            выбрать другой
          </button>
        </div>
      ) : (
        <>
          <input type="search" value={input} onChange={e => setInput(e.target.value)} placeholder="Название объекта" autoComplete="off" />
          {query.isError && <span className={styles.error}>Поиск недоступен: {(query.error as Error).message}</span>}
          {query.data && query.data.items.length === 0 && <span className={styles.hint}>Объект в базе не найден — укажите название со слов ниже.</span>}
          <ul className={styles.candidates}>
            {(query.data?.items ?? []).map(p => (
              <li key={p.id}>
                <button type="button" className={styles.candidate} onClick={() => onSelect({ id: p.id, name: p.name })}>
                  <strong>{p.name}</strong> · {PROJECT_LEVEL_LABELS[p.level] ?? p.level}
                  {p.levelLabel && ` ${p.levelLabel}`}
                  <span className={styles.quoteMeta}>
                    {p.city ?? 'город не указан'}
                    {p.parentName && ` · входит в «${p.parentName}»`}
                    {p.children > 0 && ` · очередей и корпусов: ${p.children}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};
