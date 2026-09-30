// «Источники» (бывший «Сбор»): вкладки по виду источника — каналы, сайты, ручная вставка.
//
// У каждой вкладки своя форма добавления и свой список: раньше каналы, сайты и ручные
// способы шли одним списком, и столбец «Тип» был единственным, что их различало.
// Вкладка живёт в адресе (?tab=), чтобы «Назад» и ссылка вели на ту же вкладку.

import { FC, useId } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { api } from '../../api/client';
import type { ISourceRow } from '../../api/types';
import { SiteProbeDialog } from '../../components/admin/SiteProbeDialog';
import { SourcesPanel } from '../../components/admin/SourcesPanel';
import { isSourceEnabled, useSourceActions } from '../../components/admin/useSourceActions';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Stack } from '../../components/ui/Stack';
import { TabPanel } from '../../components/ui/TabPanel';
import { Tabs } from '../../components/ui/Tabs';
import { enumParam, useUrlState } from '../../hooks/useUrlState';
import { describeLoadError } from '../../lib/loadError';

type Tab = ISourceRow['kind'];

const TABS: readonly Tab[] = ['telegram', 'website', 'manual'];

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
  const [tab, setTab] = useUrlState('tab', enumParam(TABS, 'telegram'), { history: 'push' });
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

  return (
    <Stack gap={5}>
      <Tabs label="Вид источника" idBase={idBase} items={items} value={tab} onChange={setTab} variant="pill" />
      <TabPanel idBase={idBase} value={tab} focusable={false}>
        {sourcesQuery.isLoading ? (
          <LoadingSkeleton label="Загружаю источники…" lines={5} height="56px" />
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
      <SiteProbeDialog result={actions.probeResult} onClose={actions.closeProbe} />
    </Stack>
  );
};
