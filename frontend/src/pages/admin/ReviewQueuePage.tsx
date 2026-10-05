// «Проверка»: три очереди решений оператора — противоречия источников, неясные упоминания,
// возможные дубли. Раньше неясные упоминания жили и здесь, и в «Результате», а дубли — только
// в «Результате», куда ссылка «очереди слияний» из «Проверки» не вела. Вкладка — в адресе.

import { FC, useId } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';

import { ConflictsPanel } from '../../components/admin/ConflictsPanel';
import { ambiguityPageQuery, CONFLICT_KINDS, mergesQuery, reviewQueueQuery } from '../../components/admin/reviewQueries';
import { AmbiguityList } from '../../components/AmbiguityList';
import { MergeQueuePanel } from '../../components/MergeQueuePanel';
import { Stack } from '../../components/ui/Stack';
import { TabPanel } from '../../components/ui/TabPanel';
import { Tabs } from '../../components/ui/Tabs';
import { enumParam, useUrlPatch, useUrlState } from '../../hooks/useUrlState';

type Tab = 'conflicts' | 'mentions' | 'duplicates';

const TABS: readonly Tab[] = ['conflicts', 'mentions', 'duplicates'];

export const ReviewQueuePage: FC = () => {
  const idBase = useId();
  const [tab] = useUrlState('tab', enumParam(TABS, 'conflicts'));
  const patch = useUrlPatch();

  // Числа на вкладках — те же запросы, что у списков: решение в списке сразу меняет число.
  const conflicts = useQueries({ queries: CONFLICT_KINDS.map(reviewQueueQuery) });
  const mentions = useQuery(ambiguityPageQuery('open', '', null));
  const merges = useQuery(mergesQuery);
  const conflictCount = conflicts.every(q => q.isSuccess) ? conflicts.reduce((n, q) => n + (q.data?.items.length ?? 0), 0) : null;

  // Смена вкладки сбрасывает фильтры и раскрытую строку прежней: у вкладок они свои.
  const select = (next: Tab): void =>
    patch({ tab: next === 'conflicts' ? null : next, kind: null, status: null, what: null, cursor: null, open: null }, { history: 'push' });

  return (
    <Stack gap={4}>
      <Tabs
        label="Очереди проверки"
        idBase={idBase}
        variant="pill"
        value={tab}
        onChange={select}
        items={[
          { value: 'conflicts', label: 'Противоречия', count: conflictCount },
          { value: 'mentions', label: 'Неясные упоминания', count: mentions.data?.total ?? null },
          { value: 'duplicates', label: 'Дубли', count: merges.data?.items.length ?? null },
        ]}
      />
      <TabPanel idBase={idBase} value={tab} focusable={false}>
        {tab === 'conflicts' && <ConflictsPanel />}
        {tab === 'mentions' && <AmbiguityList />}
        {tab === 'duplicates' && <MergeQueuePanel />}
      </TabPanel>
    </Stack>
  );
};
