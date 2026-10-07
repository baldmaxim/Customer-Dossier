// Вкладка «Подробно» (06.10.2026, просьба владельца «слишком много на одной странице»): вкладки вместо длинной
// страницы разделов с меню-якорями — «События · Участие и связи». Вкладка — в адресе (?dtab=, по умолчанию «События»):
// «Назад» возвращает её, ссылкой из «Сведений» можно попасть в нужную. «Показатели» (снимок на дату расчёта) сняты
// 07.10.2026: их числа повторяли плитки и полосы «Сведений», но по другому правилу и на другую дату; старый адрес
// ?dtab=numbers открывает «События».
// Глубже строк — только окнами («Откуда известно», «Контекст объекта», событие); «Опознание» и раздел
// схемы связей сняты: реквизиты и похожие — в шапке и на «Сведениях», схема — кнопкой в шапке.

import { FC, useId } from 'react';

import { enumParam, useUrlState } from '../../hooks/useUrlState';
import { TabPanel } from '../ui/TabPanel';
import { Tabs } from '../ui/Tabs';
import { CompanyEvents } from './CompanyEvents';
import { CompanyRelations } from './CompanyRelations';
import { useCompanyEvents } from './useCompanyQueries';
import styles from './CompanyDetails.module.css';

export const DETAIL_TABS = ['events', 'links'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

const LABELS: Record<DetailTab, string> = {
  events: 'События',
  links: 'Участие и связи',
};

export const CompanyDetails: FC<{ companyId: number }> = ({ companyId }) => {
  const [tab, setTab] = useUrlState('dtab', enumParam(DETAIL_TABS, 'events'), { history: 'push' });
  const idBase = useId();
  // Число событий у вкладки — из того же запроса, что и список (и плитка «События» на «Сведениях»).
  const events = useCompanyEvents(companyId);
  const eventsTotal = events.data ? (events.data.total ?? events.data.items.length) : undefined;
  const items = DETAIL_TABS.map(value => ({
    value,
    label: LABELS[value],
    count: value === 'events' && eventsTotal ? eventsTotal : undefined,
  }));

  return (
    <div className={styles.details}>
      <Tabs label="Подробно о компании" idBase={idBase} items={items} value={tab} onChange={setTab} variant="pill" size="sm" activation="manual" />
      <TabPanel idBase={idBase} value={tab} focusable={false}>
        {tab === 'events' && <CompanyEvents companyId={companyId} />}
        {tab === 'links' && <CompanyRelations companyId={companyId} />}
      </TabPanel>
    </div>
  );
};
