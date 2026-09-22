// Главная: весь пул компаний с фильтром по роли, поиск и лента последнего.
//
// Роль здесь — свойство связи, а не компании: одна фирма бывает заказчиком на
// одном объекте и подрядчиком на другом. Поэтому фильтр подписан «выступала
// в роли», и компания честно попадает сразу в несколько фильтров. Делить базу
// на «раздел Заказчики» и «раздел Генподрядчики» нельзя — это ложная
// классификация.

import { FC, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { ICompanySearchItem, IContractorRow, ISignalRefreshState, ISummaryResponse } from '../api/types';
import { identifierText } from '../components/EntityPickers';
import { RecentFeed } from '../components/RecentFeed';
import { Badge } from '../components/ui/Badge';
import { EmptyState, Section } from '../components/ui/Section';
import { Segmented } from '../components/ui/Segmented';
import { TableScroll } from '../components/ui/TableScroll';
import { ASSERTION_ROLE_LABELS, ENTITY_TYPE_LABELS, IDENTITY_STATUS_LABELS, formatDate } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import styles from './SearchPage.module.css';

type Role = 'any' | 'customer' | 'general_contractor' | 'contractor' | 'subcontractor';
type Sort = 'projects' | 'name';

const ROLES: ReadonlyArray<{ value: Role; label: string; hint?: string }> = [
  { value: 'any', label: 'Все', hint: 'все компании, какую бы роль они ни играли' },
  { value: 'customer', label: 'Заказчики', hint: 'выступала заказчиком хотя бы на одном объекте' },
  { value: 'general_contractor', label: 'Генподрядчики', hint: 'выступала генподрядчиком хотя бы на одном объекте' },
  { value: 'contractor', label: 'Подрядчики', hint: 'выступала подрядчиком хотя бы на одном объекте' },
  { value: 'subcontractor', label: 'Субподрядчики', hint: 'выступала субподрядчиком хотя бы на одном объекте' },
];

const SORTS: ReadonlyArray<{ value: Sort; label: string; hint?: string }> = [
  { value: 'projects', label: 'По числу объектов', hint: 'объём опыта в выборке, не оценка надёжности' },
  { value: 'name', label: 'По названию' },
];

interface ICatalog {
  status: 'ok' | 'not_computed';
  refresh: ISignalRefreshState;
  items: IContractorRow[];
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
  const [role, setRole] = useState<Role>('any');
  const [sort, setSort] = useState<Sort>('projects');
  const [withPublications, setWithPublications] = useState(true);
  const query = useDebounced(input.trim());

  const searchQuery = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<{ items: ICompanySearchItem[] }>(`/api/companies?q=${encodeURIComponent(query)}&limit=25`),
    enabled: query.length >= 2,
  });

  const catalog = useQuery({
    queryKey: ['catalog', role, sort, withPublications],
    queryFn: () =>
      api.get<ICatalog>(`/api/contractors?role=${role}&sort=${sort}&includeInsufficient=${!withPublications}&limit=200`),
  });

  const summaryQuery = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<ISummaryResponse>('/api/contractors/summary'),
  });

  const found = searchQuery.data?.items ?? [];
  const rows = catalog.data?.items ?? [];
  const totals = summaryQuery.data?.totals;

  return (
    <>
      <section className={styles.hero}>
        <h1 className={styles.title}>Кто есть в базе</h1>
        <p className={styles.lead}>
          Найдите компанию по названию или посмотрите весь пул — заказчиков, генподрядчиков и подрядчиков.
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
            className={styles.input}
            type="search"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Название компании"
            aria-label="Поиск компании"
            autoComplete="off"
          />
        </div>
      </section>

      {query.length >= 2 && (
        <Section title="Найдено по запросу">
          {searchQuery.isError && <p role="alert">{describeLoadError(searchQuery.error)}</p>}
          {searchQuery.isSuccess && found.length === 0 && (
            <EmptyState>Совпадений нет. Проверьте написание или посмотрите весь пул ниже.</EmptyState>
          )}
          {found.length > 0 && (
            <ul className={styles.resultList}>
              {found.map(item => (
                <li key={item.id} className={styles.resultItem}>
                  <Link to={`/company/${item.id}`}>{item.name}</Link>
                  <span className={styles.resultMeta}>
                    {ENTITY_TYPE_LABELS[item.entityType ?? ''] ?? item.entityType ?? 'юрлицо'}
                    {item.city ? ` · ${item.city}` : ''}
                    {' · '}
                    {item.identifiers && item.identifiers.length > 0
                      ? item.identifiers.map(identifierText).join(', ')
                      : 'реквизитов нет'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Пул компаний" note={totals ? `всего в базе ${totals.companies}` : undefined}>
        <div className={styles.filters}>
          <Segmented label="Роль" items={ROLES} value={role} onChange={setRole} />
          <Segmented label="Сортировка" items={SORTS} value={sort} onChange={setSort} />
          <label className={styles.check}>
            <input type="checkbox" checked={withPublications} onChange={e => setWithPublications(e.target.checked)} />
            <span>Только с публикациями</span>
          </label>
        </div>

        {catalog.isError && <p role="alert">{describeLoadError(catalog.error)}</p>}

        {catalog.data?.status === 'not_computed' && (
          <EmptyState>
            Снимок сигналов не рассчитан — каталог пуст не потому, что компаний нет. Выполните{' '}
            <code>npm run metrics:refresh</code> или включите пересчёт по расписанию.
          </EmptyState>
        )}

        {catalog.data?.status === 'ok' && rows.length === 0 && (
          <EmptyState>
            По этому фильтру компаний нет. Роль берётся из опубликованных утверждений: если её никто не
            называл, компания не попадёт ни в один фильтр, кроме «Все».
          </EmptyState>
        )}

        {/* Пять колонок, а не восемь: остальные числа живут в карточке компании, где
            у каждого есть правило, окно и знаменатель. Здесь список нужен, чтобы
            выбрать компанию, а не чтобы её оценить. */}
        {rows.length > 0 && (
          <TableScroll minWidth={640}>
            <thead>
              <tr>
                <th>Компания</th>
                <th>Выступала в роли</th>
                <th>Объектов</th>
                <th>Публикаций</th>
                <th>Связи</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                // Строка кликается целиком: ссылка с именем накрывает её собой (index.css).
                <tr key={row.companyId} className="row-link">
                  <td>
                    <Link className="row-link-target" to={`/company/${row.companyId}`}>
                      {row.name}
                    </Link>
                    <span className={styles.rowCity}>{row.city ?? 'город не установлен'}</span>
                    <Badge className={styles.rowBadge}>
                      {IDENTITY_STATUS_LABELS[row.identityStatus] ?? row.identityStatus}
                    </Badge>
                  </td>
                  <td>
                    {row.roles.length === 0
                      ? 'роль не названа'
                      : row.roles.map(r => ASSERTION_ROLE_LABELS[r] ?? r).join(', ')}
                  </td>
                  <td>{row.projects ?? '—'}</td>
                  <td>{row.publications ?? '—'}</td>
                  <td>
                    <Link className="row-link-above" to={`/links?company=${row.companyId}`}>
                      схема
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}

        <p className={styles.note}>
          «Выступала в роли» — это то, что сказано в публикациях, а не тип компании: одна и та же фирма
          бывает заказчиком на одном объекте и подрядчиком на другом.
          {catalog.data?.refresh.active ? ` Срез: ${formatDate(catalog.data.refresh.active.cutoffAt)}.` : ''}
        </p>
      </Section>

      <RecentFeed />
    </>
  );
};
