// Главная: компании или публикации — один переключатель и одна строка поиска.
//
// Поиск меняет смысл вместе с переключателем: в «Компаниях» это название, в «Публикациях» —
// слово из текста, канал или имя компании в посте. Режим и запрос живут в адресе: «Назад»
// из карточки возвращает туда же, а ссылкой на поиск можно поделиться.
//
// Роль в каталоге — свойство связи, а не компании: одна фирма бывает заказчиком на одном
// объекте и подрядчиком на другом. Поэтому фильтр подписан «выступала в роли», и компания
// честно попадает сразу в несколько фильтров.

import { FC, useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { ICompanySearchItem, IContractorRow, ISignalRefreshState, ISummaryResponse } from '../api/types';
import { PublicationBrowser, type IPublicationListItem } from '../components/PublicationBrowser';
import { EmptyState } from '../components/ui/Section';
import { Segmented } from '../components/ui/Segmented';
import { TableScroll } from '../components/ui/TableScroll';
import { ASSERTION_ROLE_LABELS } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import styles from './SearchPage.module.css';

type Mode = 'companies' | 'publications';
type Role = 'any' | 'customer' | 'general_contractor' | 'contractor' | 'subcontractor';
type Sort = 'projects' | 'name';

const MODES: ReadonlyArray<{ value: Mode; label: string; hint?: string }> = [
  { value: 'companies', label: 'Компании', hint: 'каталог и поиск по названию' },
  { value: 'publications', label: 'Публикации', hint: 'лента и поиск по тексту постов' },
];

const PLACEHOLDER: Record<Mode, string> = {
  companies: 'Название компании',
  publications: 'Слово из текста, канал, компания',
};

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

interface IFeedItem {
  id: number;
  revisionId: number | null;
  sourceTitle: string;
  sourceKind: string;
  sourceKey: string;
  publishedAt: string | null;
  firstObservedAt: string;
  url: string | null;
  title: string | null;
  topic: string | null;
  snippet: string | null;
}

/** Дебаунс: запрос на каждый символ забьёт поиск без пользы. */
const useDebounced = (value: string, delay = 300): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

const feedToListItem = (row: IFeedItem): IPublicationListItem => ({
  key: row.id,
  revisionId: row.revisionId,
  title: row.title,
  topic: row.topic,
  publishedAt: row.publishedAt,
  observedAt: row.firstObservedAt,
  sourceTitle: row.sourceTitle,
  sourceKey: row.sourceKey,
  sourceKind: row.sourceKind,
  url: row.url,
  snippet: row.snippet,
});

/** Каталог компаний: пять чисел в строке, под названием ничего — детали в карточке. */
const CompanyCatalog: FC = () => {
  const [role, setRole] = useState<Role>('any');
  const [sort, setSort] = useState<Sort>('projects');
  const [withPublications, setWithPublications] = useState(true);

  const catalog = useQuery({
    queryKey: ['catalog', role, sort, withPublications],
    queryFn: () =>
      api.get<ICatalog>(`/api/contractors?role=${role}&sort=${sort}&includeInsufficient=${!withPublications}&limit=200`),
  });
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<ISummaryResponse>('/api/contractors/summary'),
  });
  const rows = catalog.data?.items ?? [];
  const total = summary.data?.totals?.companies;

  return (
    <>
      <div className={styles.filters}>
        <Segmented label="Роль" items={ROLES} value={role} onChange={setRole} />
        <Segmented label="Сортировка" items={SORTS} value={sort} onChange={setSort} />
        <label className={styles.check}>
          <input type="checkbox" checked={withPublications} onChange={e => setWithPublications(e.target.checked)} />
          <span>Только с публикациями</span>
        </label>
        {total !== undefined && <span className={styles.total}>всего в базе {total}</span>}
      </div>

      {catalog.isError && <p role="alert">{describeLoadError(catalog.error)}</p>}
      {catalog.data?.status === 'not_computed' && (
        <EmptyState>
          Снимок сигналов не рассчитан — каталог пуст не потому, что компаний нет. Выполните{' '}
          <code>npm run metrics:refresh</code> или включите пересчёт по расписанию.
        </EmptyState>
      )}
      {catalog.data?.status === 'ok' && rows.length === 0 && (
        <EmptyState>По этому фильтру компаний нет: роль берётся только из публикаций, где её назвали.</EmptyState>
      )}

      {rows.length > 0 && (
        <TableScroll minWidth={720}>
          <thead>
            <tr>
              <th>Компания</th>
              <th>Город</th>
              <th>Выступала в роли</th>
              <th className={styles.num}>Объектов</th>
              <th className={styles.num}>Публикаций</th>
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
                </td>
                <td className={styles.muted}>{row.city ?? '—'}</td>
                <td>{row.roles.length === 0 ? '—' : row.roles.map(r => ASSERTION_ROLE_LABELS[r] ?? r).join(', ')}</td>
                <td className={styles.num}>{row.projects ?? '—'}</td>
                <td className={styles.num}>{row.publications ?? '—'}</td>
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
    </>
  );
};

/** Поиск компаний по названию: те же колонки, что у каталога, насколько поиск их знает. */
const CompanyResults: FC<{ query: string }> = ({ query }) => {
  const search = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<{ items: ICompanySearchItem[] }>(`/api/companies?q=${encodeURIComponent(query)}&limit=25`),
  });
  const found = search.data?.items ?? [];

  if (search.isError) return <p role="alert">{describeLoadError(search.error)}</p>;
  if (search.isLoading) return <p className={styles.muted}>Поиск…</p>;
  if (found.length === 0) return <EmptyState>Совпадений нет. Проверьте написание или очистите поиск.</EmptyState>;

  return (
    <TableScroll minWidth={480}>
      <thead>
        <tr>
          <th>Компания</th>
          <th>Город</th>
          <th className={styles.num}>Объектов</th>
        </tr>
      </thead>
      <tbody>
        {found.map(item => (
          <tr key={item.id} className="row-link">
            <td>
              <Link className="row-link-target" to={`/company/${item.id}`}>
                {item.name}
              </Link>
            </td>
            <td className={styles.muted}>{item.city ?? '—'}</td>
            <td className={styles.num}>{item.projects ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

/** Лента публикаций и поиск по ним: список слева, пост справа. */
const PublicationFeed: FC<{ query: string }> = ({ query }) => {
  const feed = useInfiniteQuery({
    queryKey: ['feed', query],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '30' });
      if (query.length >= 2) params.set('q', query);
      if (pageParam) params.set('cursor', pageParam);
      return api.get<{ items: IFeedItem[]; nextCursor: string | null }>(`/api/feed?${params}`);
    },
    getNextPageParam: last => last.nextCursor,
  });

  return (
    <PublicationBrowser
      items={(feed.data?.pages.flatMap(p => p.items) ?? []).map(feedToListItem)}
      isLoading={feed.isLoading}
      error={feed.error}
      hasMore={feed.hasNextPage}
      loadingMore={feed.isFetchingNextPage}
      onLoadMore={() => void feed.fetchNextPage()}
      empty={
        query.length >= 2
          ? 'По этому запросу публикаций нет. Поиск идёт по тексту поста, его теме и названию канала.'
          : 'Публикаций пока нет. Сбор идёт только по источникам с подтверждённым допуском.'
      }
    />
  );
};

export const SearchPage: FC = () => {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('view') === 'publications' ? 'publications' : 'companies';
  const [input, setInput] = useState(params.get('q') ?? '');
  const query = useDebounced(input.trim());

  // Запрос — в адрес без новой записи истории: «Назад» ведёт с карточки к поиску, а не по буквам.
  useEffect(() => {
    const current = params.get('q') ?? '';
    if (current === query) return;
    const next = new URLSearchParams(params);
    if (query === '') next.delete('q');
    else next.set('q', query);
    setParams(next, { replace: true });
  }, [query, params, setParams]);

  const switchMode = (value: Mode): void => {
    const next = new URLSearchParams(params);
    if (value === 'companies') next.delete('view');
    else next.set('view', value);
    setParams(next);
  };

  const searching = query.length >= 2;

  return (
    <>
      <h1 className="visually-hidden">{mode === 'companies' ? 'Компании' : 'Публикации'}</h1>
      <div className={styles.bar}>
        <Segmented label="Что показать" items={MODES} value={mode} onChange={switchMode} size="md" />
        <label className={styles.field}>
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
            placeholder={PLACEHOLDER[mode]}
            aria-label={mode === 'companies' ? 'Поиск компании' : 'Поиск по публикациям'}
            autoComplete="off"
          />
        </label>
      </div>

      {mode === 'companies' ? (
        searching ? (
          <CompanyResults query={query} />
        ) : (
          <CompanyCatalog />
        )
      ) : (
        <PublicationFeed query={searching ? query : ''} />
      )}
    </>
  );
};
