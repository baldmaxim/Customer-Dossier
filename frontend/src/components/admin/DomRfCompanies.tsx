// Компании на ДОМ.РФ (этап 20D, шаг 2): каждую компанию портала браузер ищет в едином реестре
// застройщиков — заказчиков и застройщиков первыми, по ИНН, если он есть, иначе по названию. Найденное —
// предложения: «Это он» отправляет страницу застройщика или группы в чтение, и её объекты приходят
// во вкладку «Объекты». Компаний тысячи: фильтр и поиск — на сервере, на экране — первые сто; оба — в адресе.

import { FC, useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { DomRfCompanyFilter, IDomRfCompanies, IDomRfCompanyLink, IDomRfCompanyRow, IDomRfDecisionResult } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { useDebounced } from '../../hooks/useDebounced';
import { enumParam, stringParam, useUrlState } from '../../hooks/useUrlState';
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
import { useConfirm } from '../ui/confirm';
import { useToast } from '../ui/toast';
import { actionError } from './actionError';
import { DomRfCompanyLinks } from './DomRfCompanyLinks';
import { DOMRF_SUMMARY_KEY } from './domRfSummary';
import styles from './Found.module.css';

const QUERY_KEY = ['domrf-companies'];

const FILTERS: readonly DomRfCompanyFilter[] = ['pending', 'notFound', 'confirmed', 'several', 'all'];

/** Что ещё сделало решение: закрытые записи, вернувшиеся в «ждёт решения», ушедшие из «Объектов» объекты. */
const consequences = (result: IDomRfDecisionResult): string =>
  [
    result.closed > 0 ? `другие записи компании — «не он»: ${formatCount(result.closed)}` : '',
    result.reopened > 0 ? `снова ждут решения: ${formatCount(result.reopened)}` : '',
    result.withdrawnObjects > 0 ? `ушло из «Объектов»: ${formatCount(result.withdrawnObjects)}` : '',
  ]
    .filter(Boolean)
    .join('; ');

const withConsequences = (text: string, result: IDomRfDecisionResult): string => {
  const more = consequences(result);
  return more ? `${text} ${more[0]!.toUpperCase()}${more.slice(1)}.` : text;
};

const nameOf = (link: IDomRfCompanyLink): string => link.name ?? `№${link.externalRef}`;

const HINT =
  'Каждую компанию портала браузер ищет в едином реестре застройщиков ДОМ.РФ — заказчиков и застройщиков первыми: по ИНН, если он есть, иначе по названию. Из выдачи по названию предлагаются только застройщики и группы, совпавшие с названием, — выберите своего. Подтверждённый уходит в чтение, его объекты появятся во вкладке «Объекты».';

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
  if (filter === 'several') return 'Разобрано: у каждой компании отмечено не больше одной записи.';
  return filter === 'pending' ? 'Решать пока нечего: поиск идёт в фоне, по три компании в минуту.' : 'Таких компаний нет.';
};

export const DomRfCompanies: FC = () => {
  const client = useQueryClient();
  const toast = useToast();
  const canDecide = useCan('sources.manage');
  const ask = useConfirm();
  const [filter, setFilter] = useUrlState('filter', enumParam(FILTERS, 'pending'));
  const [q, setQ] = useUrlState('q', stringParam());
  const [input, setInput] = useState(q);
  const typed = useDebounced(input.trim());
  // Набранное уходит в адрес с задержкой: «Назад» с карточки компании возвращает к тому же поиску.
  // Только при наборе: смена адреса снаружи не должна возвращать в него старый текст поля.
  useEffect(() => {
    setQ(typed);
  }, [typed, setQ]);
  const params = new URLSearchParams({ filter, ...(q ? { q } : {}) });
  const data = useQuery({
    queryKey: [...QUERY_KEY, filter, q],
    queryFn: () => api.get<IDomRfCompanies>(`/api/admin/domrf-companies?${params.toString()}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: QUERY_KEY });
    void client.invalidateQueries({ queryKey: ['domrf-candidates'] });
    void client.invalidateQueries({ queryKey: DOMRF_SUMMARY_KEY });
  };
  const after = (text: string) => (): void => {
    toast.show({ tone: 'success', text });
    refresh();
  };
  const afterDecision = (text: string) => (result: IDomRfDecisionResult): void => {
    toast.show({ tone: 'success', text: withConsequences(text, result) });
    refresh();
  };
  const fail = (err: Error): void => {
    toast.show({ tone: 'danger', text: actionError(err) });
  };
  const confirm = useMutation({
    mutationFn: (link: IDomRfCompanyLink) => api.post<IDomRfDecisionResult>(`/api/admin/domrf-company-links/${link.id}/confirm`, {}),
    onSuccess: afterDecision('Подтверждено — портал прочитает страницу, объекты появятся во вкладке «Объекты».'),
    onError: fail,
  });
  const reject = useMutation({
    mutationFn: (link: IDomRfCompanyLink) => api.post<IDomRfDecisionResult>(`/api/admin/domrf-company-links/${link.id}/reject`, {}),
    onSuccess: afterDecision('Отклонено: при повторном поиске не вернётся.'),
    onError: fail,
  });
  const undo = useMutation({
    mutationFn: (link: IDomRfCompanyLink) => api.post<IDomRfDecisionResult>(`/api/admin/domrf-company-links/${link.id}/undo`, {}),
    onSuccess: afterDecision('Отменено — запись снова ждёт решения.'),
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
  const busy = confirm.isPending || reject.isPending || undo.isPending || manual.isPending || again.isPending;

  // «Это он» при уже отмеченной записи — замена выбора, «Оставить только эту» — закрыть остальные: оба
  // снимают чужие страницы и их объекты, поэтому — с вопросом.
  const choose = async (row: IDomRfCompanyRow, link: IDomRfCompanyLink): Promise<void> => {
    const chosen = row.links.filter(l => l.state === 'confirmed' && l.id !== link.id);
    if (chosen.length > 0) {
      const keepOnly = link.state === 'confirmed';
      const ok = await ask({
        title: keepOnly ? `Оставить только «${nameOf(link)}»?` : `Заменить выбор у «${row.name}»?`,
        body: `${chosen.map(nameOf).join(', ')} — станет «не он». Объекты ${chosen.length > 1 ? 'их страниц' : 'её страницы'}, ещё ждущие решения, уйдут из «Объектов».`,
        confirmLabel: keepOnly ? 'Оставить только эту' : 'Заменить',
      });
      if (!ok) return;
    }
    confirm.mutate(link);
  };

  const cancel = async (link: IDomRfCompanyLink): Promise<void> => {
    if (link.state === 'confirmed') {
      const ok = await ask({
        title: `Отменить «это он» у «${nameOf(link)}»?`,
        body: 'Запись снова будет ждать решения. Объекты её страницы, ещё ждущие решения, уйдут из «Объектов»; закрытые этим выбором записи тоже вернутся в «ждёт решения».',
        confirmLabel: 'Отменить отметку',
      });
      if (!ok) return;
    }
    undo.mutate(link);
  };

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
              // Пока есть что разбирать: отмеченные до правила «одна запись на компанию».
              ...(totals?.several || filter === 'several' ? [{ value: 'several' as const, label: `Отмечено несколько${count(totals?.several)}` }] : []),
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
                  onConfirm={link => void choose(row, link)}
                  onReject={link => reject.mutate(link)}
                  onUndo={link => void cancel(link)}
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
