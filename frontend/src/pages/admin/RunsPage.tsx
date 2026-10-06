// «Обработка»: что в базе, где сейчас тексты и последние разборы — только чтение.
//
// Обработка идёт сама: портал ставит разбор по новым версиям текстов включённых источников и
// переносит разобранное в карточки. Здесь видно, почему текст туда не попал. Бывший «Конвейер»
// (счётчики состояний) и журнал переноса из «Результата» — здесь же, а флаги фоновых заданий —
// в строке состояния над разделами. Фильтры и страница списка — в адресе.

import { FC, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { api } from '../../api/client';
import type { IRunPage, ISourceRow, RunListState, RunStatus } from '../../api/types';
import { BaseTotals } from '../../components/admin/BaseTotals';
import { Pager } from '../../components/admin/Pager';
import { PublicationLog } from '../../components/admin/PublicationLog';
import { RUN_LIST_STATES, RevisionStates } from '../../components/admin/RevisionStates';
import { RUN_STATUSES, RunsFilters } from '../../components/admin/RunsFilters';
import { RunsList } from '../../components/admin/RunsList';
import { useCursorPaging } from '../../components/admin/useCursorPaging';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Disclosure } from '../../components/ui/Disclosure';
import { EmptyState } from '../../components/ui/EmptyState';
import { Section } from '../../components/ui/Section';
import { Stack } from '../../components/ui/Stack';
import { enumParam, numberParam, useUrlPatch, useUrlState } from '../../hooks/useUrlState';
import { formatCount } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';
import formStyles from '../../components/admin/Forms.module.css';

const PAGE = 50;
const STATUS_VALUES: readonly (RunStatus | '')[] = ['', ...RUN_STATUSES];
const STATE_VALUES: readonly (RunListState | '')[] = ['', ...RUN_LIST_STATES];

export const RunsPage: FC = () => {
  const [sourceId] = useUrlState('source', numberParam(null));
  const [status] = useUrlState('status', enumParam(STATUS_VALUES, ''));
  const [state] = useUrlState('state', enumParam(STATE_VALUES, ''));
  const patch = useUrlPatch();
  const listRef = useRef<HTMLDivElement>(null);
  const paging = useCursorPaging('before', listRef);
  const before = paging.cursor !== null && /^\d+$/.test(paging.cursor) ? paging.cursor : null;
  // Журнал грузится, только когда его открыли: свёрнутый он запроса не стоит.
  const [logOpened, setLogOpened] = useState(false);

  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ items: ISourceRow[] }>('/api/admin/sources'),
  });
  const sourceItems = sources.data?.items ?? [];
  const byId = new Map(sourceItems.map(s => [s.id, s]));

  const page = useQuery({
    queryKey: ['runs', sourceId, status, state, before],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (sourceId !== null) params.set('sourceId', String(sourceId));
      if (status) params.set('status', status);
      if (state) params.set('state', state);
      if (before) params.set('beforeId', before);
      return api.get<IRunPage>(`/api/reprocess/runs?${params.toString()}`);
    },
  });
  const data = page.data;

  // Смена фильтра начинает список сначала: курсор прежней выборки к новой не относится. Плитка и статус
  // друг друга сменяют: у плитки свои статусы разборов, вместе они дали бы пустой список.
  const filter = (next: { sourceId?: number | null; status?: RunStatus | ''; state?: RunListState | '' }): void =>
    patch({
      ...(next.sourceId !== undefined ? { source: next.sourceId } : {}),
      ...(next.status !== undefined || next.state !== undefined ? { status: next.status ?? null, state: next.state ?? null } : {}),
      before: null,
    });

  return (
    <Stack gap={4}>
      <BaseTotals />
      <RevisionStates state={state} onFilter={next => filter({ state: next })} />

      <div ref={listRef}>
        <Section title="Последние разборы" note={data ? `всего по фильтру: ${formatCount(data.total)}` : undefined} id="runs">
          <Stack gap={4}>
            <RunsFilters sources={sourceItems} sourceId={sourceId} status={status} state={state} onChange={filter} />
            {page.isLoading && (
              <LoadingSkeleton label="Загружаю разборы…" lines={6} height="44px" />
            )}
            {page.isError && (
              <Callout tone="danger" title="Разборы не загрузились" action={<Button onClick={() => void page.refetch()}>Повторить</Button>}>
                {describeLoadError(page.error)}
              </Callout>
            )}
            {data && data.items.length === 0 && (
              <EmptyState
                size="sm"
                action={
                  sourceId !== null || status !== '' || state !== '' ? (
                    <Button onClick={() => filter({ sourceId: null, status: '', state: '' })}>Сбросить фильтры</Button>
                  ) : undefined
                }
              >
                Разборов по фильтру нет.
              </EmptyState>
            )}
            {data && data.items.length > 0 && <RunsList runs={data.items} sources={byId} />}
            <Pager
              label="Страницы разборов"
              hasNewer={paging.hasNewer}
              hasOlder={Boolean(data?.nextBeforeId)}
              onNewer={paging.newer}
              onOlder={() => data?.nextBeforeId && paging.older(data.nextBeforeId)}
            />
          </Stack>
        </Section>
      </div>

      <Disclosure variant="card" level={2} summary="Журнал переноса в карточки" onToggle={open => open && setLogOpened(true)}>
        <Stack gap={3}>
          <p className={formStyles.hint}>Перенос автоматический: найденное уходит в карточки сразу после полного разбора текста.</p>
          {logOpened && <PublicationLog />}
        </Stack>
      </Disclosure>
    </Stack>
  );
};
