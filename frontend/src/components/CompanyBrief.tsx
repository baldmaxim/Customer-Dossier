// «Коротко о компании»: полоса плиток-итогов во всю ширину «Сведений» (объекты · генподрядчики · события · публикации ·
// связи · суды · реестр). У каждой плитки — разбивка мелко и ссылка туда, где число расписано; заголовок
// полосы — только для диктора: плитки сами себя называют. Роли — ярлыками в шапке и полосами в «Ролях,
// событиях и текстах», а не третьей строкой здесь (05.10.2026).
//
// Здесь нет ни одного нового числа: всё берётся из расчёта показателей, уже загруженных
// объектов, событий и реестра — те же числа стоят в «Подробно → Показатели» с правилом и
// знаменателем. Итоговой оценки, балла и светофора нет и не будет (ADR-009) — сводка
// отвечает «что известно», а не «хорошая ли это компания»; плитки одного нейтрального тона.
//
// Показатели могут быть не посчитаны, устареть или не загрузиться. Тогда сводка говорит это
// словами и показывает то, что видно без них, а не подставляет ноль вместо неизвестного.
// Числа правил signals@2 (связи, суды) в старом снимке отсутствуют — их плиток тогда нет.
// Когда посчитаны и что это не оценка — в «Источниках и датах» внизу вкладки (CompanySources).

import { FC } from 'react';

import type { ICompanyObject, ICompanyResponse, ISignalAggregate } from '../api/types';
import { formatCount } from '../lib/format';
import { formatDate, formatMoney } from '../lib/labels';
import { Sparkline } from './charts/Sparkline';
import { BriefTile } from './company/BriefTile';
import { BUILDERS_SECTION_ID } from './company/CompanyBuilders';
import { CHECKS_SECTION_ID } from './company/CompanyChecks';
import { FINANCE_SECTION_ID } from './company/CompanyFinance';
import { EVENTS_SECTION_ID } from './company/eventOrder';
import { useCompanyBuilders, useCompanyChecks, useCompanyEvents, useCompanyFinance, useCompanySignals } from './company/useCompanyQueries';
import { Button } from './ui/Button';
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
  /** Ответ карточки (из кэша): реестр и его объекты. */
  company?: ICompanyResponse;
}

/** Города своих объектов (объекты СЗ группы — не её): «Казань, Москва и ещё 2». */
const citiesText = (objects: ICompanyObject[]): string | null => {
  const cities = [...new Set(objects.filter(o => !o.via).map(o => o.city).filter((c): c is string => Boolean(c)))];
  if (cities.length === 0) return null;
  return cities.length > 2 ? `${cities.slice(0, 2).join(', ')} и ещё ${cities.length - 2}` : cities.join(', ');
};

/** Число показателя: посчитано — числом, нет данных или нет показателя — «—». */
const aggregateText = (aggregate: ISignalAggregate | undefined): string =>
  aggregate?.status === 'ok' ? formatCount(aggregate.value) : '—';

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

const known = (label: string, aggregate: ISignalAggregate | undefined): string | null =>
  aggregate?.status === 'ok' ? `${label} — ${formatCount(aggregate.value)}` : null;

export const CompanyBrief: FC<ICompanyBriefProps> = ({ companyId, objects, objectsTotal, objectsKnown, company }) => {
  const query = useCompanySignals(companyId);
  const events = useCompanyEvents(companyId);
  const builders = useCompanyBuilders(companyId);
  // Последний год отчётности ГИР БО (24B); старый сервер маршрута не знает — плитки нет.
  const finance = useCompanyFinance(companyId);
  const latestYear = finance.data?.finance?.view?.years?.[0];
  // Картотека дел и ФССП (24C): плитки — только когда сведения получены.
  const checks = useCompanyChecks(companyId);
  const courts = checks.data?.courts?.view?.recognized ? checks.data.courts.view : null;
  const fssp = checks.data?.fssp?.view?.recognized ? checks.data.fssp.view : null;
  // Старый сервер маршрута не знает: без objects плитки нет, а не падение сводки.
  const generals = (builders.data?.items ?? []).filter(b => b.roles.includes('general_contractor'));
  const signals = query.data?.signals ?? null;
  const refresh = query.data?.refresh;

  const media = signals?.media;
  const experience = signals?.experience;
  const latest = media?.latestPublishedAt;
  const registry = company?.registry ?? null;
  const cases = media?.legalCasesCount;
  // Мини-график — последние 12 месяцев ряда signals@3 (24 столбика в 72px сливаются); старый снимок — без него.
  const byMonth = media?.publicationsByMonth;
  const spark = byMonth?.status === 'ok' ? <Sparkline values={byMonth.buckets.slice(-12).map(b => b.value)} partialLast={byMonth.partialLast} /> : undefined;

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
          detail={joinDetail([known('с датой за 12 мес.', media?.eventsDated12m)])}
          to={{ search: '?tab=details', hash: EVENTS_SECTION_ID }}
          linkText="Все события"
        />
        <BriefTile
          label="Публикации"
          value={aggregateText(media?.publications)}
          chart={spark}
          detail={joinDetail([known('за 90 дней', media?.publications90d), latest?.value ? `последняя ${formatDate(latest.value)}` : null])}
          to={{ search: '?tab=publications' }}
          linkText="Все публикации"
        />
        {experience?.counterparties && (
          <BriefTile
            label="Связи"
            value={aggregateText(experience.counterparties)}
            detail={joinDetail([known('договоров', experience.contractsCount), known('корпоративных', experience.corporateCount)])}
            to={`/links?company=${companyId}`}
            linkText="Все связи"
            viewTransition
          />
        )}
        {media && cases && (
          <BriefTile
            label="Суды"
            value={aggregateText(cases)}
            detail={
              cases.status === 'ok' && (cases.value ?? 0) > 0
                ? joinDetail([`истец — ${formatCount(media.courtRoles.plaintiff)}`, `ответчик — ${formatCount(media.courtRoles.defendant)}`])
                : null
            }
            to={{ search: '?tab=details', hash: 'company-signals' }}
            linkText="Дела подробно"
          />
        )}
        {registry && (
          <BriefTile
            label="Реестр"
            value={formatCount((company?.registryProjects ?? []).length)}
            detail={joinDetail(['объектов в реестре', registry.asOf ? `на ${formatDate(registry.asOf)}` : null])}
            to={{ search: '', hash: 'company-registry' }}
            linkText="Сведения реестра"
          />
        )}
      </dl>
      {refresh?.active && <p className={styles.briefNote}>показатели на {formatDate(refresh.active.cutoffAt)}</p>}
      {query.isError && (
        <p className={styles.note}>
          Показатели не загрузились — числа публикаций не показаны.{' '}
          <Button variant="link" size="sm" onClick={() => void query.refetch()}>
            Повторить
          </Button>
        </p>
      )}
    </section>
  );
};
