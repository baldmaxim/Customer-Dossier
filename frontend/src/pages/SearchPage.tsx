import { FC, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { ICompanySearchItem, RiskLight } from '../api/types';
import { RiskBadge } from '../components/RiskBadge';
import styles from './SearchPage.module.css';

interface ISummary {
  byRisk: Array<{ riskLight: RiskLight; n: number }>;
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

  return (
    <>
      <h1 className={styles.title}>Как дела у Заказчика?</h1>
      <p className={styles.lead}>
        Введите название компании — «BI Group», «БИ Групп» или «Базис-А». Написание значения
        не имеет.
      </p>

      <input
        type="search"
        className={styles.input}
        placeholder="Название компании"
        value={input}
        onChange={e => setInput(e.target.value)}
        autoComplete="off"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />

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
              <span className={styles.resultName}>{item.name}</span>
              <span className={styles.resultMeta}>
                {[item.legalForm, item.city].filter(Boolean).join(' · ')}
              </span>
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

          <div className={styles.riskRow}>
            {(summaryQuery.data?.byRisk ?? [])
              .slice()
              .sort((a, b) => ORDER.indexOf(a.riskLight) - ORDER.indexOf(b.riskLight))
              .map(r => (
                <span key={r.riskLight} className={styles.riskItem}>
                  <RiskBadge light={r.riskLight} />
                  <span className={styles.riskCount}>{r.n}</span>
                </span>
              ))}
          </div>

          {totals.pendingMerges > 0 && (
            <p className={styles.hint}>
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

const ORDER: RiskLight[] = ['red', 'yellow', 'green', 'grey'];

const SummaryStat: FC<{ value: number; label: string }> = ({ value, label }) => (
  <div className={styles.summaryStat}>
    <div className={styles.summaryValue}>{value.toLocaleString('ru-RU')}</div>
    <div className={styles.summaryLabel}>{label}</div>
  </div>
);
