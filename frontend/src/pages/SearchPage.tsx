import { FC, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { ICompanySearchItem } from '../api/types';
import { ENTITY_TYPE_LABELS, IDENTITY_STATUS_LABELS } from '../lib/labels';
import { identifierText } from '../components/EntityPickers';
import styles from './SearchPage.module.css';

interface ISummary {
  byIdentity: Array<{ identityStatus: string; n: number }>;
  totals: {
    companies: number;
    projects: number;
    documents: number;
    pendingMerges: number;
    lonelyCompanies: number;
  } | null;
}

/** Дебаунс: запрос на каждый символ забьёт trgm-поиск без пользы. */
const useDebounced = (value: string, delay = 300): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

export const SearchPage: FC = () => {
  const [input, setInput] = useState('');
  const query = useDebounced(input.trim());

  const searchQuery = useQuery({
    queryKey: ['search', query],
    queryFn: () =>
      api.get<{ items: ICompanySearchItem[] }>(
        `/api/companies?q=${encodeURIComponent(query)}&limit=25`,
      ),
    enabled: query.length >= 2,
  });

  const summaryQuery = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<ISummary>('/api/contractors/summary'),
  });

  const items = searchQuery.data?.items ?? [];
  const totals = summaryQuery.data?.totals;
  const byIdentity = summaryQuery.data?.byIdentity ?? [];

  return (
    <>
      <section className={styles.hero}>
        <h1 className={styles.title}>Как дела у Заказчика?</h1>
        <p className={styles.lead}>
          Введите название компании — «ПИК», «Самолёт» или «Глоракс». Написание значения не
          имеет.
        </p>

        <div className={styles.field}>
          <svg
            className={styles.fieldIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M10.75 3.75a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM15.9 15.9 20.5 20.5" />
          </svg>
          <input
            type="search"
            className={styles.input}
            placeholder="Название компании"
            value={input}
            onChange={e => setInput(e.target.value)}
            autoComplete="off"
            enterKeyHint="search"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        </div>
      </section>

      {query.length >= 2 && (
        <div className={styles.results}>
          {searchQuery.isLoading && <p className={styles.hint}>Ищу…</p>}
          {searchQuery.isSuccess && items.length === 0 && (
            <p className={styles.hint}>
              Ничего не найдено. Компания попадёт в базу, когда её упомянут в отслеживаемых
              источниках.
            </p>
          )}
          {items.map(item => (
            <Link key={item.id} to={`/company/${item.id}`} className={styles.resultRow}>
              <span className={styles.resultText}>
                <span className={styles.resultName}>{item.name}</span>
                <span className={styles.resultMeta}>
                  {[
                    item.legalForm,
                    item.entityType && item.entityType !== 'unknown' ? ENTITY_TYPE_LABELS[item.entityType] : null,
                    item.city,
                    item.identifiers && item.identifiers.length > 0 ? item.identifiers.map(identifierText).join(', ') : 'реквизитов нет',
                    item.projects !== null && item.projects !== undefined ? `объектов: ${item.projects}` : null,
                    item.matchedAlias ? `написание «${item.matchedAlias}»` : null,
                    item.homonyms ? `одноимённых: ${item.homonyms} — сверьте реквизиты` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <svg
                className={styles.chevron}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m9.5 5.5 7 6.5-7 6.5" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {query.length < 2 && totals && (
        <section className={styles.summary}>
          <h2 className={styles.summaryTitle}>Что в базе</h2>
          <div className={styles.summaryGrid}>
            <SummaryStat value={totals.companies} label="компаний" />
            <SummaryStat value={totals.projects} label="объектов" />
            <SummaryStat value={totals.documents} label="разобрано сообщений" />
          </div>

          {byIdentity.length > 0 && (
            <p className={styles.hintPlain}>
              Идентификация компаний:{' '}
              {byIdentity.map(r => `${IDENTITY_STATUS_LABELS[r.identityStatus] ?? r.identityStatus} — ${r.n}`).join('; ')}.
            </p>
          )}

          {totals.pendingMerges > 0 && (
            <p className={styles.hintPlain}>
              <Link to="/admin">{totals.pendingMerges} пар</Link> ждут решения о слиянии.
            </p>
          )}
          {/* Много компаний ровно с одним упоминанием — признак, что резолвер
              стал слишком осторожным и плодит дубли. */}
          {totals.companies > 20 && totals.lonelyCompanies / totals.companies > 0.5 && (
            <p className={styles.warning}>
              У {totals.lonelyCompanies} компаний ровно одно упоминание. Похоже на нераспознанные
              дубли — стоит просмотреть очередь слияний.
            </p>
          )}
        </section>
      )}
    </>
  );
};

const SummaryStat: FC<{ value: number; label: string }> = ({ value, label }) => (
  <div className={styles.summaryStat}>
    <div className={styles.summaryValue}>{value.toLocaleString('ru-RU')}</div>
    <div className={styles.summaryLabel}>{label}</div>
  </div>
);
