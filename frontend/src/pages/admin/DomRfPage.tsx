// Страница наш.дом.рф (Админка → Источники → Сайты → наш.дом.рф): всё, что ждёт решения инженера, —
// вкладками. «Компании» — компании портала, найденные в реестре застройщиков («Это он / Не он», подсказки
// модели), «Объекты» — дома со страниц подтверждённых застройщиков и групп, «Карточки» — карточки объектов
// в сборе. Вкладка, фильтр и поиск — в адресе: «Назад» с карточки компании возвращает туда же.

import { FC, useId } from 'react';
import { useQuery } from '@tanstack/react-query';

import { DomRfCandidates } from '../../components/admin/DomRfCandidates';
import { DomRfCompanies } from '../../components/admin/DomRfCompanies';
import { DomRfHintsPanel } from '../../components/admin/DomRfHintsPanel';
import { DomRfTargets } from '../../components/admin/DomRfTargets';
import { domRfSummaryQuery } from '../../components/admin/domRfSummary';
import { PageHeader } from '../../components/ui/PageHeader';
import { Stack } from '../../components/ui/Stack';
import { TabPanel } from '../../components/ui/TabPanel';
import { Tabs } from '../../components/ui/Tabs';
import { enumParam, useUrlPatch, useUrlState } from '../../hooks/useUrlState';

type Tab = 'companies' | 'objects' | 'cards';

const TABS: readonly Tab[] = ['companies', 'objects', 'cards'];

export const DomRfPage: FC = () => {
  const idBase = useId();
  const [tab] = useUrlState('tab', enumParam(TABS, 'companies'));
  const patch = useUrlPatch();
  const summary = useQuery(domRfSummaryQuery);
  const data = summary.data;

  // У вкладок свои фильтры: смена вкладки их сбрасывает.
  const select = (next: Tab): void => patch({ tab: next === 'companies' ? null : next, filter: null, q: null }, { history: 'push' });

  return (
    <Stack gap={4}>
      <PageHeader eyebrow="Админка · Источники · Сайты" title="наш.дом.рф" lead="Единый реестр застройщиков: что нашёл браузер на сервере и что ждёт вашего решения." />
      <Tabs
        label="Разделы ДОМ.РФ"
        idBase={idBase}
        variant="pill"
        value={tab}
        onChange={select}
        items={[
          { value: 'companies', label: 'Компании', count: data?.companies.withPending ?? null, hint: 'компаний с найденным, ждут решения' },
          { value: 'objects', label: 'Объекты', count: data?.objects.pending ?? null, hint: 'объектов ждут решения' },
          { value: 'cards', label: 'Карточки', count: data?.cards.total ?? null, hint: 'карточек объектов в сборе' },
        ]}
      />
      <TabPanel idBase={idBase} value={tab} focusable={false}>
        {tab === 'companies' && (
          <Stack gap={4}>
            {data && <DomRfHintsPanel hints={data.hints} />}
            <DomRfCompanies />
          </Stack>
        )}
        {tab === 'objects' && <DomRfCandidates />}
        {tab === 'cards' && <DomRfTargets />}
      </TabPanel>
    </Stack>
  );
};
