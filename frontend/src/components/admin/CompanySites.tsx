// Очередь «Сайты компаний» (этап 25A): что нашёл веб-поиск и что ждёт решения оператора. Компаний тысячи —
// фильтр и поиск на сервере, на экране первые сто; оба — в адресе («Назад» с карточки возвращает туда же).

import { FC, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { CompanySitesFilter, ICompanySitesList, ICompanySitesRow } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { useDebounced } from '../../hooks/useDebounced';
import { enumParam, stringParam, useUrlState } from '../../hooks/useUrlState';
import { formatCount } from '../../lib/format';
import { roleLabel } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { SiteCandidates, SiteControls, searchLine } from '../companySite/SiteCandidates';
import { COMPANY_SITES_KEY, useSiteActions } from '../companySite/useSiteActions';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { Cluster } from '../ui/Cluster';
import { EmptyState } from '../ui/EmptyState';
import { Hint } from '../ui/Hint';
import { Loading } from '../ui/Loading';
import { SearchInput } from '../ui/SearchInput';
import { Section } from '../ui/Section';
import { Segmented } from '../ui/Segmented';
import { Stack } from '../ui/Stack';
import styles from './Found.module.css';

const FILTERS: readonly CompanySitesFilter[] = ['pending', 'notFound', 'confirmed', 'all'];

const HINT =
  'Модель ищет официальный сайт компании в интернете — заказчиков и застройщиков первыми. Адрес предлагается, только если поиск действительно нашёл страницы этого сайта. Портал открывает главную и страницы «Контакты / О компании» и смотрит, написан ли там ИНН компании. Решаете вы: «Это сайт компании» или «Не он».';

const metaOf = (row: ICompanySitesRow, mode: ICompanySitesList['mode']): string => {
  const roles = row.roles.map(roleLabel).join(', ');
  const search = searchLine(row.search, mode);
  return roles ? `${roles} · ${search}` : search;
};

const emptyText = (filter: CompanySitesFilter, q: string): string => {
  if (q) return `Компаний «${q}» здесь нет.`;
  if (filter === 'pending') return 'Решать пока нечего: поиск идёт в фоне, по две компании за проход.';
  return 'Таких компаний нет.';
};

export const CompanySites: FC = () => {
  const canDecide = useCan('sources.manage');
  const actions = useSiteActions();
  const [filter, setFilter] = useUrlState('filter', enumParam(FILTERS, 'pending'));
  const [q, setQ] = useUrlState('q', stringParam());
  const [input, setInput] = useState(q);
  const typed = useDebounced(input.trim());
  useEffect(() => {
    setQ(typed);
  }, [typed, setQ]);
  const params = new URLSearchParams({ filter, ...(q ? { q } : {}) });
  const data = useQuery({
    queryKey: [...COMPANY_SITES_KEY, filter, q],
    queryFn: () => api.get<ICompanySitesList>(`/api/admin/company-sites?${params.toString()}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const list = data.data;
  const totals = list?.totals;
  const items = list?.items ?? [];
  const count = (n: number | undefined): string => (n === undefined ? '' : `: ${formatCount(n)}`);

  return (
    <Section
      title="Компании"
      variant="plain"
      note={totals ? `искали ${formatCount(totals.searched)}, сайт привязан у ${formatCount(totals.confirmed)}` : undefined}
      actions={
        <Cluster gap={2} align="center">
          <Segmented<CompanySitesFilter>
            label="Компании"
            items={[
              { value: 'pending', label: `Ждут решения${count(totals?.withPending)}` },
              { value: 'notFound', label: `Не найдены${count(totals?.notFound)}` },
              { value: 'confirmed', label: `С сайтом${count(totals?.confirmed)}` },
              { value: 'all', label: 'Все' },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <Hint label="Сайты компаний" text={HINT} />
        </Cluster>
      }
    >
      <Stack gap={3}>
        <SearchInput label="Компания по названию" placeholder="Название компании" size="md" value={input} onChange={setInput} />
        {data.isLoading && <Loading label="Загружаю компании…" />}
        {data.isError && (
          <Callout tone="danger" title="Список не загрузился" action={<Button onClick={() => void data.refetch()}>Повторить</Button>}>
            {describeLoadError(data.error)}
          </Callout>
        )}
        {data.isSuccess && items.length === 0 && <EmptyState size="sm">{emptyText(filter, q)}</EmptyState>}
        {list && items.length > 0 && (
          <CardList label="Сайты компаний">
            {items.map(row => (
              <CardListItem
                key={row.companyId}
                title={
                  <ButtonLink to={`/company/${row.companyId}`} variant="link" size="sm">
                    {row.name}
                  </ButtonLink>
                }
                meta={metaOf(row, list.mode)}
              >
                <Stack gap={2}>
                  {row.candidates.length > 0 && (
                    <SiteCandidates
                      candidates={row.candidates}
                      canDecide={canDecide}
                      busy={actions.busy}
                      onConfirm={actions.confirm}
                      onReject={c => void actions.reject(c)}
                    />
                  )}
                  {canDecide && (
                    <SiteControls
                      companyName={row.name}
                      searched={Boolean(row.search?.searchedAt)}
                      busy={actions.busy}
                      onManual={url => actions.manual(row.companyId, url)}
                      onSearch={() => actions.search(row.companyId)}
                    />
                  )}
                </Stack>
              </CardListItem>
            ))}
          </CardList>
        )}
        {list && list.matched > items.length && (
          <p className={styles.muted}>
            Показаны первые {formatCount(items.length)} из {formatCount(list.matched)} — уточните поиском по названию.
          </p>
        )}
      </Stack>
    </Section>
  );
};
