// «Источники» (бывший «Сбор»): вкладки по виду источника — каналы, сайты, ручная вставка.
//
// У каждой вкладки своя форма добавления и свой список: раньше каналы, сайты и ручные
// способы шли одним списком, и столбец «Тип» был единственным, что их различало.
// Вкладка живёт в адресе (?tab=), чтобы «Назад» и ссылка вели на ту же вкладку; фильтр
// «Не собираются» (?problems=1) относится к списку вкладки и при её смене снимается.

import { FC, useId } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { api } from '../../api/client';
import type { ISourceRow } from '../../api/types';
import { SiteProbeDialog } from '../../components/admin/SiteProbeDialog';
import { SourceDetailsDialog } from '../../components/admin/SourceDetailsDialog';
import { SourcesPanel } from '../../components/admin/SourcesPanel';
import { isSourceEnabled, useSourceActions } from '../../components/admin/useSourceActions';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Stack } from '../../components/ui/Stack';
import { TabPanel } from '../../components/ui/TabPanel';
import { Tabs } from '../../components/ui/Tabs';
import { enumParam, useUrlPatch, useUrlState } from '../../hooks/useUrlState';
import { describeLoadError } from '../../lib/loadError';

type Tab = ISourceRow['kind'];

const TABS: readonly Tab[] = ['telegram', 'website', 'manual'];
const DEFAULT_TAB: Tab = 'telegram';

// Коротко: на 360px три вкладки с числами должны помещаться в строку без прокрутки.
const TAB_TITLES: Record<Tab, string> = {
  telegram: 'Telegram',
  website: 'Сайты',
  manual: 'Вручную',
};

/** Имя списка для диктора — полным словом. */
const LIST_LABELS: Record<Tab, string> = {
  telegram: 'Telegram-каналы',
  website: 'Сайты',
  manual: 'Способы ручной передачи',
};

export const SourcesPage: FC = () => {
  const idBase = useId();
  const [tab] = useUrlState('tab', enumParam(TABS, DEFAULT_TAB), { history: 'push' });
  const patch = useUrlPatch();
  const actions = useSourceActions();
  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ items: ISourceRow[] }>('/api/admin/sources'),
  });

  const sources = sourcesQuery.data?.items ?? [];
  const items = TABS.map(value => {
    const all = sources.filter(s => s.kind === value);
    const on = all.filter(isSourceEnabled).length;
    return {
      value,
      label: TAB_TITLES[value],
      // Сколько всего — числом на вкладке; сколько из них включено — в пояснении и над списком.
      count: sourcesQuery.isSuccess ? all.length : null,
      hint: all.length > 0 ? `включено ${on} из ${all.length}` : undefined,
    };
  });

  // Одной записью истории: вкладка и снятый фильтр (два сеттера подряд затёрли бы друг друга).
  const selectTab = (next: Tab): void => patch({ tab: next === DEFAULT_TAB ? null : next, problems: null }, { history: 'push' });

  return (
    <Stack gap={4}>
      <Tabs label="Вид источника" idBase={idBase} items={items} value={tab} onChange={selectTab} variant="pill" />
      <TabPanel idBase={idBase} value={tab} focusable={false}>
        {sourcesQuery.isLoading ? (
          <LoadingSkeleton label="Загружаю источники…" lines={6} height="48px" />
        ) : sourcesQuery.isError ? (
          <Callout
            tone="danger"
            title="Источники не загрузились"
            action={<Button onClick={() => void sourcesQuery.refetch()}>Повторить</Button>}
          >
            {describeLoadError(sourcesQuery.error)}
          </Callout>
        ) : (
          <SourcesPanel kind={tab} sources={sources} actions={actions} label={LIST_LABELS[tab]} />
        )}
      </TabPanel>
      <SourceDetailsDialog
        source={sources.find(s => s.id === actions.detailsId) ?? null}
        actions={actions}
        onClose={actions.closeDetails}
      />
      <SiteProbeDialog result={actions.probeResult} onClose={actions.closeProbe} />
    </Stack>
  );
};
