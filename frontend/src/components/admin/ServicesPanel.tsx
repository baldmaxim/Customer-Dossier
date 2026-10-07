// Вкладка «Сервисы» (Админка → Источники, 06.10.2026): Контур.Фокус, parser-api.com и поиск сайтов компаний.
// Это не источники публикаций, а справочники по реквизиту и веб-поиск, поэтому — своей вкладкой, а не под
// таблицей сайтов. Каждый сервис — строкой с коротким состоянием; нажатие раскрывает настройку на месте
// (ключ, лимиты, журнал, очередь) вместо отдельной страницы. Раскрытый — в адресе (?open=), прежние адреса
// страниц ведут сюда же (routes.tsx). Содержимое монтируется только раскрытым: закрытые не грузят журнал
// и очередь.

import { FC, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { enumParam, useUrlState } from '../../hooks/useUrlState';
import { formatCount } from '../../lib/format';
import { PARSER_API_CONNECTION_LABELS } from '../../lib/labels';
import { parserApiConnectionState } from '../../lib/parserApiConnection';
import { Disclosure } from '../ui/Disclosure';
import { HeadingLevelContext } from '../ui/headingLevel';
import { Stack } from '../ui/Stack';
import { CompanySitesPanel } from './CompanySitesPanel';
import { companySitesSummaryQuery } from './companySitesSettings';
import { FocusPanel } from './FocusPanel';
import { focusSettingsQuery } from './focusSettings';
import { ParserApiPanel } from './ParserApiPanel';
import { parserApiSettingsQuery } from './parserApiSettings';

type ServiceKey = 'focus' | 'parser-api' | 'company-sites';
type OpenValue = ServiceKey | 'none';

const OPEN_VALUES: readonly OpenValue[] = ['none', 'focus', 'parser-api', 'company-sites'];

interface IServiceItemProps {
  id: ServiceKey;
  title: string;
  /** Коротко справа от названия: состояние, видно и в свёрнутом виде. */
  meta: string;
  open: OpenValue;
  onOpen: (next: OpenValue) => void;
  children: ReactNode;
}

const ServiceItem: FC<IServiceItemProps> = ({ id, title, meta, open, onOpen, children }) => {
  const isOpen = open === id;
  return (
    <Disclosure
      variant="card"
      level={2}
      summary={title}
      meta={meta || undefined}
      open={isOpen}
      // Браузер сообщает и о раскрытии, выставленном из адреса: повторная запись того же значения не нужна.
      onToggle={next => {
        if (next && !isOpen) onOpen(id);
        if (!next && isOpen) onOpen('none');
      }}
    >
      {isOpen && <HeadingLevelContext.Provider value={3}>{children}</HeadingLevelContext.Provider>}
    </Disclosure>
  );
};

export const ServicesPanel: FC = () => {
  const [open, setOpen] = useUrlState('open', enumParam(OPEN_VALUES, 'none'));
  const focus = useQuery(focusSettingsQuery).data;
  const parserApi = useQuery(parserApiSettingsQuery).data;
  const sites = useQuery(companySitesSummaryQuery).data;

  const focusMeta = !focus ? '' : focus.key.source === 'none' ? 'ключ не задан' : `запросов за сутки: ${formatCount(focus.usedLastDay)} из ${formatCount(focus.dailyLimit)}`;
  const parserApiMeta = !parserApi
    ? ''
    : PARSER_API_CONNECTION_LABELS[parserApiConnectionState(parserApi)];
  const sitesMeta = !sites ? '' : `${sites.mode === 'on' ? '' : 'поиск выключен, '}ждут решения: ${formatCount(sites.totals.withPending)}`;

  return (
    <Stack gap={3}>
      <ServiceItem id="focus" title="Контур.Фокус — сведения ЕГРЮЛ" meta={focusMeta} open={open} onOpen={setOpen}>
        <FocusPanel />
      </ServiceItem>
      <ServiceItem id="parser-api" title="parser-api.com — открытые реестры" meta={parserApiMeta} open={open} onOpen={setOpen}>
        <ParserApiPanel />
      </ServiceItem>
      <ServiceItem id="company-sites" title="Сайты компаний" meta={sitesMeta} open={open} onOpen={setOpen}>
        <CompanySitesPanel />
      </ServiceItem>
    </Stack>
  );
};
