// «Коротко о компании»: полоса плиток-итогов во всю ширину «Сведений» (объекты · генподрядчики · выручка · стройка ·
// арбитраж · ФССП · события · публикации · связи). У каждой плитки — разбивка мелко и ссылка туда, где число расписано;
// заголовок полосы — только для диктора: плитки сами себя называют.
//
// Число плитки — то же, что у списка, куда она ведёт (07.10.2026, «одно сведение — один источник»): объекты — вкладка
// «Объекты», события — «Подробно → События» (итоги в том же ответе), публикации — лента (publication-stats), связи —
// «С кем связана» (те же контрагенты и их число). Раньше события, публикации, связи и суды брались из снимка
// показателей на дату расчёта и не сходились со списками; плитка «Суды» по публикациям дублировала «Арбитраж» (КАД) —
// снята, судебные события из постов остаются в «Событиях». Итоговой оценки, балла и светофора нет (ADR-009).

import { FC } from 'react';

import type { ICompanyObject } from '../api/types';
import { formatCount } from '../lib/format';
import { formatDate, formatMoney } from '../lib/labels';
import { Sparkline } from './charts/Sparkline';
import { BriefTile } from './company/BriefTile';
import { BUILDERS_SECTION_ID } from './company/CompanyBuilders';
import { CHECKS_SECTION_ID } from './company/CompanyChecks';
import { DELIVERY_SECTION_ID } from './company/CompanyDelivery';
import { FINANCE_SECTION_ID } from './company/CompanyFinance';
import { PARTNERS_LIMIT } from './CompanyPartners';
import { useCompanyBuilders, useCompanyChecks, useCompanyDelivery, useCompanyEvents, useCompanyFinance, useCompanyPartners, useCompanyPublicationStats } from './company/useCompanyQueries';
import { Heading } from './ui/Heading';
import styles from './CompanyBrief.module.css';

interface ICompanyBriefProps {
  companyId: number;
  /** Объекты вкладки «Объекты» (свои и застройщиков группы). */
  objects: ICompanyObject[];
  /** Сколько объектов всего, включая не вошедшие в выборку. */
  objectsTotal: number;
  /** Список объектов пришёл: до этого «—», а не «0». */
  objectsKnown: boolean;
}

/** Города своих объектов (объекты СЗ группы — не её): «Казань, Москва и ещё 2». */
const citiesText = (objects: ICompanyObject[]): string | null => {
  const cities = [...new Set(objects.filter(o => !o.via).map(o => o.city).filter((c): c is string => Boolean(c)))];
  if (cities.length === 0) return null;
  return cities.length > 2 ? `${cities.slice(0, 2).join(', ')} и ещё ${cities.length - 2}` : cities.join(', ');
};

/**
 * «за 90 дней — 4 · последняя 30.09.2026»: только известные части. Пробелы у тире —
 * неразрывные: узкая плитка переносит «ответчик — 3» целиком, а не оставляет «— 3» на
 * следующей строке.
 */
const joinDetail = (parts: Array<string | null>): string | null => {
  const known = parts.filter((p): p is string => Boolean(p)).map(p => p.replace(/ — /g, '\u00a0—\u00a0'));
  return known.length > 0 ? known.join(' · ') : null;
};

/** «СУ-10, МонАрх и ещё 2»: генподрядчики раньше подрядчиков (порядок сервера). */
const namesText = (names: string[]): string | null => {
  if (names.length === 0) return null;
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} и ещё ${names.length - 2}` : names.join(', ');
};

/** «за 90 дней — 4»: известное число с подписью. */
const known = (label: string, value: number | null | undefined): string | null => (value !== null && value !== undefined ? `${label} — ${formatCount(value)}` : null);

export const CompanyBrief: FC<ICompanyBriefProps> = ({ companyId, objects, objectsTotal, objectsKnown }) => {
  const events = useCompanyEvents(companyId);
  const publications = useCompanyPublicationStats(companyId);
  const partners = useCompanyPartners(companyId, PARTNERS_LIMIT);
  const builders = useCompanyBuilders(companyId);
  // Последний год отчётности ГИР БО (24B); старый сервер маршрута не знает — плитки нет.
  const finance = useCompanyFinance(companyId);
  const latestYear = finance.data?.finance?.view?.years?.[0];
  // Картотека дел и ФССП (24C): плитки — только когда сведения получены.
  const checks = useCompanyChecks(companyId);
  const courts = checks.data?.courts?.view?.recognized ? checks.data.courts.view : null;
  const fssp = checks.data?.fssp?.view?.recognized ? checks.data.fssp.view : null;
  // Дома ДОМ.РФ (24E): плитка — только если у компании есть дома в реестре.
  const delivery = useCompanyDelivery(companyId);
  const houses = (delivery.data?.houses ?? 0) > 0 ? delivery.data! : null;
  // Старый сервер маршрута не знает: без objects плитки нет, а не падение сводки.
  const generals = (builders.data?.items ?? []).filter(b => b.roles.includes('general_contractor'));

  // Старый сервер маршрута итогов не знает (ответ без total) — плитка говорит «—», а не падает.
  const pubs = typeof publications.data?.total === 'number' ? publications.data : undefined;
  const eventStats = events.data?.stats;
  const links = partners.data?.counts;
  // Мини-график — последние 12 месяцев ряда (24 столбика в 72px сливаются).
  const spark = pubs?.byMonth?.status === 'ok' ? <Sparkline values={pubs.byMonth.buckets.slice(-12).map(b => b.value)} partialLast={pubs.byMonth.partialLast} /> : undefined;

  return (
    <section className={styles.brief}>
      <Heading className="visually-hidden">Коротко о компании</Heading>
      <dl className={styles.tiles}>
        <BriefTile
          label="Объекты"
          value={objectsKnown ? formatCount(objectsTotal) : '—'}
          detail={citiesText(objects)}
          to={{ search: '?tab=objects' }}
          linkText="Все объекты"
        />
        {(builders.data?.objects?.customerSide ?? 0) > 0 && (
          <BriefTile
            label="Генподрядчики"
            value={formatCount(generals.length)}
            detail={namesText(generals.map(b => b.company?.name ?? b.name)) ?? 'не названы ни ДОМ.РФ, ни в публикациях'}
            to={{ search: '', hash: BUILDERS_SECTION_ID }}
            linkText="Кто строит для компании"
          />
        )}
        {latestYear && (
          <BriefTile
            label="Выручка"
            value={latestYear.revenue !== null ? formatMoney(latestYear.revenue) : '—'}
            detail={joinDetail([`за ${latestYear.year}`, latestYear.netProfit !== null ? `чистая прибыль ${formatMoney(latestYear.netProfit)}` : null])}
            to={{ search: '', hash: FINANCE_SECTION_ID }}
            linkText="Финансы и налоги"
          />
        )}
        {houses && (
          <BriefTile
            label="Стройка"
            value={formatCount(houses.inProgress.count)}
            detail={joinDetail([
              'домов строится',
              `сдано за 24 мес. — ${formatCount(houses.delivered.recent)}`,
              houses.pastDue.length > 0 ? `срок прошёл — ${formatCount(houses.pastDue.length)}` : null,
            ])}
            to={{ search: '', hash: DELIVERY_SECTION_ID }}
            linkText="Сроки и продажи"
          />
        )}
        {courts && (
          <BriefTile
            label="Арбитраж"
            value={`${formatCount(courts.total)}${courts.complete ? '' : '+'}`}
            detail={joinDetail(['дел за 24 мес.', courts.byRole.respondent > 0 ? `ответчик — ${formatCount(courts.byRole.respondent)}` : null, courts.byRole.plaintiff > 0 ? `истец — ${formatCount(courts.byRole.plaintiff)}` : null])}
            to={{ search: '', hash: CHECKS_SECTION_ID }}
            linkText="Арбитражные дела"
          />
        )}
        {fssp && (
          <BriefTile
            label="ФССП"
            value={formatCount(fssp.open.count)}
            detail={joinDetail(['не окончено', fssp.open.remainingCovered > 0 ? `остаток ${formatMoney(fssp.open.remaining)}` : null])}
            to={{ search: '', hash: CHECKS_SECTION_ID }}
            linkText="Исполнительные производства"
          />
        )}
        <BriefTile
          label="События"
          value={events.isSuccess ? formatCount(events.data.total ?? events.data.items.length) : '—'}
          detail={joinDetail([known('с датой за 12 мес.', eventStats?.dated12m)])}
          to={{ search: '?tab=details' }}
          linkText="Все события"
        />
        <BriefTile
          label="Публикации"
          value={pubs ? formatCount(pubs.total) : '—'}
          chart={spark}
          detail={joinDetail([known('за 90 дней', pubs?.last90), pubs?.latestAt ? `последняя ${formatDate(pubs.latestAt)}` : null])}
          to={{ search: '?tab=publications' }}
          linkText="Все публикации"
        />
        {links && (
          <BriefTile
            label="Связи"
            value={formatCount(links.companies)}
            detail={joinDetail([known('договоров', links.contracts), known('корпоративных', links.corporate)])}
            to={{ search: '?tab=details&dtab=links' }}
            linkText="Все связи"
          />
        )}
      </dl>
    </section>
  );
};
