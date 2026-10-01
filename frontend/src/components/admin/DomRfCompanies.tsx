// Компании на ДОМ.РФ (этап 20D, шаг 2): каждую компанию портала браузер ищет в едином реестре
// застройщиков — заказчиков и застройщиков первыми, по ИНН, если он есть, иначе по названию. Найденное —
// предложения: «Это он» отправляет страницу застройщика или группы в чтение, и её объекты приходят
// в «Найдено на ДОМ.РФ». Компаний тысячи: фильтр и поиск — на сервере, на экране — первые сто.

import { FC, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { DomRfCompanyFilter, IDomRfCompanies, IDomRfCompanyLink, IDomRfCompanyRow } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { useDebounced } from '../../hooks/useDebounced';
import { formatCount } from '../../lib/format';
import { ASSERTION_ROLE_LABELS, DOMRF_FOUND_BY_LABELS, formatDateTime } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
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
import { useToast } from '../ui/toast';
import { actionError } from './actionError';
import { DomRfCompanyLinks } from './DomRfCompanyLinks';
import styles from './Found.module.css';

const QUERY_KEY = ['domrf-companies'];

const HINT =
  'Каждую компанию портала браузер ищет в едином реестре застройщиков ДОМ.РФ — заказчиков и застройщиков первыми: по ИНН, если он есть, иначе по названию. Из выдачи по названию предлагаются только застройщики и группы, совпавшие с названием, — выберите своего. Подтверждённый уходит в чтение, его объекты появятся в «Найдено на ДОМ.РФ».';

const searchMeta = (row: IDomRfCompanyRow): string => {
  const roles = row.roles.map(role => ASSERTION_ROLE_LABELS[role] ?? role).join(', ');
  const search = ((): string => {
    if (row.lastError) return `поиск не удался: ${row.lastError}`;
    if (!row.searchedAt) return 'ещё не искали — в очереди';
    const how = row.foundBy ? DOMRF_FOUND_BY_LABELS[row.foundBy] : 'поиск';
    return `${how} «${row.query ?? ''}», ${formatDateTime(row.searchedAt)}: найдено ${row.resultCount ?? 0}`;
  })();
  return roles ? `${roles} · ${search}` : search;
};

const emptyText = (filter: DomRfCompanyFilter, q: string): string => {
  if (q) return `Компаний «${q}» здесь нет.`;
  return filter === 'pending' ? 'Решать пока нечего: поиск идёт в фоне, по три компании в минуту.' : 'Таких компаний нет.';
};

export const DomRfCompanies: FC = () => {
  const client = useQueryClient();
  const toast = useToast();
  const canDecide = useCan('sources.manage');
  const [filter, setFilter] = useState<DomRfCompanyFilter>('pending');
  const [input, setInput] = useState('');
  const q = useDebounced(input.trim());
  const params = new URLSearchParams({ filter, ...(q ? { q } : {}) });
  const data = useQuery({
    queryKey: [...QUERY_KEY, filter, q],
    queryFn: () => api.get<IDomRfCompanies>(`/api/admin/domrf-companies?${params.toString()}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const after = (text: string) => (): void => {
    toast.show({ tone: 'success', text });
    void client.invalidateQueries({ queryKey: QUERY_KEY });
    void client.invalidateQueries({ queryKey: ['domrf-candidates'] });
  };
  const fail = (err: Error): void => {
    toast.show({ tone: 'danger', text: actionError(err) });
  };
  const confirm = useMutation({
    mutationFn: (link: IDomRfCompanyLink) => api.post(`/api/admin/domrf-company-links/${link.id}/confirm`, {}),
    onSuccess: after('Подтверждено — портал прочитает страницу, объекты появятся в «Найдено на ДОМ.РФ».'),
    onError: fail,
  });
  const reject = useMutation({
    mutationFn: (link: IDomRfCompanyLink) => api.post(`/api/admin/domrf-company-links/${link.id}/reject`, {}),
    onSuccess: after('Отклонено: при повторном поиске не вернётся.'),
    onError: fail,
  });
  const manual = useMutation({
    mutationFn: (input: { companyId: number; url: string }) => api.post(`/api/admin/domrf-companies/${input.companyId}/link`, { url: input.url }),
    onSuccess: after('Сохранено — портал прочитает указанную страницу.'),
    onError: fail,
  });
  const again = useMutation({
    mutationFn: (companyId: number) => api.post(`/api/admin/domrf-companies/${companyId}/search`, {}),
    onSuccess: after('Компания — первая в очереди поиска.'),
    onError: fail,
  });
  const busy = confirm.isPending || reject.isPending || manual.isPending || again.isPending;

  const totals = data.data?.totals;
  const items = data.data?.items ?? [];
  const matched = data.data?.matched ?? 0;
  const count = (n: number | undefined): string => (n === undefined ? '' : `: ${formatCount(n)}`);

  return (
    <Section
      title="Компании на ДОМ.РФ"
      note={totals ? `проверено ${formatCount(totals.searched)} из ${formatCount(totals.companies)}, найдено ${formatCount(totals.confirmed)}` : undefined}
      actions={
        <Cluster gap={2} align="center">
          <Segmented<DomRfCompanyFilter>
            label="Компании"
            items={[
              { value: 'pending', label: `Ждут решения${count(totals?.withPending)}` },
              { value: 'notFound', label: `Не найдены${count(totals?.notFound)}` },
              { value: 'confirmed', label: `Найдены${count(totals?.confirmed)}` },
              { value: 'all', label: 'Все' },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <Hint label="Компании на ДОМ.РФ" text={HINT} />
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
        {items.length > 0 && (
          <CardList label="Компании на ДОМ.РФ">
            {items.map(row => (
              <CardListItem
                key={row.companyId}
                title={
                  <ButtonLink to={`/company/${row.companyId}`} variant="link" size="sm">
                    {row.name}
                  </ButtonLink>
                }
                meta={searchMeta(row)}
              >
                <DomRfCompanyLinks
                  company={row}
                  canDecide={canDecide}
                  busy={busy}
                  onConfirm={link => confirm.mutate(link)}
                  onReject={link => reject.mutate(link)}
                  onManual={url => manual.mutate({ companyId: row.companyId, url })}
                  onSearchAgain={() => again.mutate(row.companyId)}
                />
              </CardListItem>
            ))}
          </CardList>
        )}
        {matched > items.length && (
          <p className={styles.muted}>
            Показаны первые {formatCount(items.length)} из {formatCount(matched)} — уточните поиском по названию.
          </p>
        )}
      </Stack>
    </Section>
  );
};
