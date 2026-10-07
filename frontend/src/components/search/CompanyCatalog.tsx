// Каталог компаний на главной (без запроса в поиске), ADR-016: «Юрлица · Группы · Без ИНН». Основа —
// реквизит, а не публикации: юрлицо видно и тогда, когда о нём ещё не писали. Вид и фильтры — в адресе,
// до 200 строк, под списком — честно, сколько показано из скольких.

import { FC, ReactNode, memo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ICatalogResponse, ICatalogRow } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatCount, formatCountWord } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';
import { MQ } from '../../lib/media';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Segmented } from '../ui/Segmented';
import { Stack } from '../ui/Stack';
import { CatalogFilters } from './CatalogFilters';
import { CatalogRows } from './CatalogRows';
import { CATALOG_LIMIT, CATALOG_VIEWS, catalogQuery, useCatalogParams } from './catalogParams';
import styles from './Search.module.css';

const ROW_FORMS = ['строка', 'строки', 'строк'] as const;

/** Пустой список одним объектом: новый `[]` на каждый рендер сбивал бы memo у CatalogRows. */
const NO_ROWS: ICatalogRow[] = [];

const EMPTY_TEXT: Record<string, string> = {
  legal: 'Компаний с ИНН по этому фильтру нет. Завести компанию можно поиском: наберите её ИНН.',
  groups: 'Групп компаний по этому фильтру нет.',
  unidentified: 'Имён без ИНН по этому фильтру нет.',
};

const CompanyCatalogView: FC = () => {
  const params = useCatalogParams();
  const wide = useMediaQuery(MQ.sm);
  const { view, watch, role, sort } = params;
  const watchActive = view !== 'unidentified' && watch;

  const catalog = useQuery({
    queryKey: ['catalog', view, watchActive, role, sort],
    queryFn: () => api.get<ICatalogResponse>(catalogQuery({ view, watch: watchActive, role, sort })),
    // Смена фильтра не стирает список до ответа: прежние строки видны, пока идёт запрос.
    placeholderData: keepPreviousData,
  });

  const counts = catalog.data?.counts;
  const views = CATALOG_VIEWS.map(v => ({
    ...v,
    label: counts ? `${v.label} · ${formatCount(counts[v.value])}` : v.label,
  }));
  const rows = catalog.data?.view === view ? catalog.data.items : NO_ROWS;
  const total = catalog.data?.total ?? 0;
  const filtered = watchActive || role !== 'any';

  let body: ReactNode;
  if (catalog.isLoading) {
    body = <LoadingSkeleton label="Загружаю компании…" lines={8} height="44px" />;
  } else if (catalog.isError && !catalog.data) {
    body = (
      <Callout tone="danger" title="Не удалось загрузить компании" action={<Button onClick={() => void catalog.refetch()}>Повторить</Button>}>
        {describeLoadError(catalog.error)}
      </Callout>
    );
  } else if (rows.length === 0 && !catalog.isFetching) {
    body = (
      <EmptyState
        title="Здесь пока пусто"
        action={
          filtered ? (
            <Button
              onClick={() => {
                params.setWatch(false);
                params.setRole('any');
              }}
            >
              Сбросить фильтр
            </Button>
          ) : undefined
        }
      >
        {EMPTY_TEXT[view]}
      </EmptyState>
    );
  } else {
    body = (
      <>
        <div aria-busy={catalog.isFetching || undefined}>
          <CatalogRows view={view} rows={rows} />
        </div>
        <p className={styles.footnote}>
          {total > rows.length
            ? `Показаны первые ${formatCount(CATALOG_LIMIT)} из ${formatCount(total)} — уточните поиск по названию или ИНН.`
            : `Показано: ${formatCountWord(rows.length, ROW_FORMS)}.`}
          {view === 'unidentified' && (counts?.dismissed ?? 0) > 0 && ` Отмечено «не компания» и не показано: ${formatCount(counts?.dismissed ?? 0)}.`}
        </p>
      </>
    );
  }

  return (
    <Stack gap={3}>
      <Segmented label="Что показать" items={views} value={view} onChange={params.setView} size="md" fill={!wide} />
      {view === 'unidentified' && (
        <Callout tone="neutral">
          Это имена из публикаций, у которых нет ИНН: портал не знает, какое это юрлицо. Откройте имя, чтобы назначить его
          компании, — тогда публикации перейдут к ней.
        </Callout>
      )}
      <CatalogFilters params={params} />
      {body}
    </Stack>
  );
};

// memo (07.10.2026): поле поиска живёт в CompaniesPage, и каждая буква перерисовывала страницу вместе с 200 строками
// каталога. Пропсов нет — родитель каталог больше не перерисовывает; адрес и ответ API доходят через хуки, как прежде.
export const CompanyCatalog = memo(CompanyCatalogView);
