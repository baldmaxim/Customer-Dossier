// Страница «Сайты компаний» (Админка → Источники → Сайты → Сайты компаний, этап 25A): идёт ли веб-поиск,
// расход за сутки и очередь решений. Поиск включает владелец флагом сервера после пробы; без OpenRouter
// искать нечем — страница говорит это словами, а не пустым списком.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { CompanySites } from '../../components/admin/CompanySites';
import { companySitesSummaryQuery } from '../../components/admin/companySitesSettings';
import { Callout } from '../../components/ui/Callout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Stack } from '../../components/ui/Stack';
import { formatCount } from '../../lib/format';
import { SITE_SEARCH_MODE_LABELS } from '../../lib/labels';

export const CompanySitesPage: FC = () => {
  const summary = useQuery(companySitesSummaryQuery);
  const data = summary.data;
  return (
    <Stack gap={4}>
      <PageHeader
        eyebrow="Админка · Источники · Сайты"
        title="Сайты компаний"
        lead={
          data
            ? `Поисков за сутки: ${formatCount(data.totals.usedLastDay)} из ${formatCount(data.dailyLimit)}. Каждый поиск платный (веб-поиск OpenRouter).`
            : 'Официальные сайты компаний: модель ищет в интернете, вы подтверждаете.'
        }
      />
      {data && data.mode !== 'on' && (
        <Callout tone="info" title={SITE_SEARCH_MODE_LABELS[data.mode][0]!.toUpperCase() + SITE_SEARCH_MODE_LABELS[data.mode].slice(1)}>
          {data.mode === 'off'
            ? 'Новых кандидатов не будет, пока владелец не включит поиск на сервере (SITE_SEARCH_ENABLED). Сайт можно указать вручную.'
            : 'Веб-поиск есть только у OpenRouter (LLM_PROVIDER=openrouter). Сайт можно указать вручную.'}
        </Callout>
      )}
      <CompanySites />
    </Stack>
  );
};
