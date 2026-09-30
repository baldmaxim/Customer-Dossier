// Каталог компаний на главной (без запроса в поиске): фильтры в адресе, до 200 строк, под
// списком — честно, сколько показано из скольких в базе.

import { FC, ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IContractorRow, ISignalRefreshState, ISummaryResponse } from '../../api/types';
import { useUrlPatch } from '../../hooks/useUrlState';
import { formatCount, formatCountWord } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Stack } from '../ui/Stack';
import { CatalogFilters } from './CatalogFilters';
import { CatalogRows } from './CatalogRows';
import { CATALOG_LIMIT, useCatalogParams } from './catalogParams';
import styles from './Search.module.css';

interface ICatalog {
  status: 'ok' | 'not_computed';
  refresh: ISignalRefreshState;
  items: IContractorRow[];
}

const COMPANY_FORMS = ['компания', 'компании', 'компаний'] as const;
/** После «из»: «из 21 компании», «из 12 334 компаний». */
const COMPANY_FORMS_GENITIVE = ['компании', 'компаний', 'компаний'] as const;

export const CompanyCatalog: FC = () => {
  const params = useCatalogParams();
  const patch = useUrlPatch();
  const { role, sort, all } = params;

  const catalog = useQuery({
    queryKey: ['catalog', role, sort, all],
    queryFn: () =>
      api.get<ICatalog>(`/api/contractors?role=${role}&sort=${sort}&includeInsufficient=${all}&limit=${CATALOG_LIMIT}`),
    // Смена фильтра не стирает список до ответа: прежние строки видны, пока идёт запрос.
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<ISummaryResponse>('/api/contractors/summary'),
  });

  const rows = catalog.data?.items ?? [];
  const total = summary.data?.totals?.companies;

  let body: ReactNode;
  if (catalog.isLoading) {
    body = (
      <LoadingSkeleton label="Загружаю компании…" lines={8} height="44px" />
    );
  } else if (catalog.isError && !catalog.data) {
    body = (
      <Callout
        tone="danger"
        title="Не удалось загрузить компании"
        action={<Button onClick={() => void catalog.refetch()}>Повторить</Button>}
      >
        {describeLoadError(catalog.error)}
      </Callout>
    );
  } else if (catalog.data?.status === 'not_computed') {
    body = (
      <EmptyState title="Список компаний ещё не готов">
        Найдите компанию по названию в строке поиска — поиск работает и без списка.
      </EmptyState>
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        title="По этому фильтру компаний нет"
        action={<Button onClick={() => patch({ role: null, all: null })}>Сбросить фильтр</Button>}
      >
        Роль берётся только из публикаций, где её назвали.
      </EmptyState>
    );
  } else {
    body = (
      <>
        <div aria-busy={catalog.isFetching || undefined}>
          <CatalogRows rows={rows} />
        </div>
        <p className={styles.footnote}>
          {rows.length >= CATALOG_LIMIT && total !== undefined
            ? `Показаны первые ${formatCount(CATALOG_LIMIT)} из ${formatCountWord(total, COMPANY_FORMS_GENITIVE)} в базе — уточните поиск по названию.`
            : `Показано: ${formatCountWord(rows.length, COMPANY_FORMS)}.`}
        </p>
      </>
    );
  }

  return (
    <Stack gap={3}>
      {/* Пока список не посчитан, фильтровать нечего: остаётся только поиск по названию. */}
      {catalog.data?.status !== 'not_computed' && <CatalogFilters params={params} />}
      {body}
    </Stack>
  );
};
