// «Публикации и события по месяцам» на вкладке «Сведения» (05.10.2026). Два ряда — два графика на одной оси месяцев,
// у каждого своя шкала (dual-axis на одном графике выдумал бы связь рядов). С 07.10.2026 ряды — из тех же наборов, что
// лента публикаций и список событий (publication-stats, stats в ответе событий), а не из снимка показателей: сумма ряда
// и плитки сходятся. Здесь только форма; что не вошло — словами (без даты, раньше окна, даты до квартала). Это форма
// потока сведений, а не оценка компании (ADR-009): всплеск публикаций — повод открыть публикации, не вывод.

import { FC } from 'react';

import type { ISignalMonthlySeries } from '../../api/types';
import { formatCount, formatCountWord, type PluralForms } from '../../lib/format';
import { formatMonth } from '../../lib/labels';
import { ChartData } from '../charts/ChartData';
import { MonthBars } from '../charts/MonthBars';
import { Section } from '../ui/Section';
import { useCompanyEvents, useCompanyPublicationStats } from './useCompanyQueries';
import styles from './Company.module.css';

const PUBLICATIONS: PluralForms = ['публикация', 'публикации', 'публикаций'];
const EVENTS: PluralForms = ['событие', 'события', 'событий'];
/** После «из» — родительный падеж: «из 1 публикации», «из 3 публикаций». */
const OF_PUBLICATIONS: PluralForms = ['публикации', 'публикаций', 'публикаций'];
const OF_EVENTS: PluralForms = ['события', 'событий', 'событий'];

/** «учтено 120 из 140 публикаций; не вошли: 15 раньше…, 5 без даты» — что вошло в ряд и почему не вошло остальное. */
const coverageText = (series: ISignalMonthlySeries, ofForms: PluralForms): string => {
  const first = series.buckets[0]?.month;
  const e = series.excluded;
  const parts = [
    e.beforeWindow > 0 && first ? `${formatCount(e.beforeWindow)} раньше начала ряда` : null,
    e.undated > 0 ? `${formatCount(e.undated)} без даты` : null,
    e.coarse > 0 ? `${formatCount(e.coarse)} с датой до квартала или года` : null,
    e.future > 0 ? `${formatCount(e.future)} с датой позже среза` : null,
    e.registry > 0 ? `${formatCount(e.registry)} — снимки ДОМ.РФ (дата сбора, а не публикации)` : null,
  ].filter(Boolean);
  const head = `учтено ${formatCount(series.value ?? 0)} из ${formatCountWord(series.denominator ?? 0, ofForms)}`;
  return parts.length > 0 ? `${head}; не вошли: ${parts.join(', ')}` : head;
};

export const CompanyActivity: FC<{ companyId: number }> = ({ companyId }) => {
  const pubStats = useCompanyPublicationStats(companyId).data;
  const eventStats = useCompanyEvents(companyId).data?.stats;
  // Старый сервер рядов не присылает — блока нет, а не падение.
  const pubs = pubStats?.byMonth?.buckets ? pubStats.byMonth : undefined;
  const events = eventStats?.byMonth?.buckets ? eventStats.byMonth : undefined;
  if (!pubs && !events) return null;
  const title = 'Публикации и события по месяцам';
  const lastMonth = (pubs ?? events)!.buckets.at(-1)?.month;

  const months = (pubs ?? events)!.buckets.map(b => b.month);
  const valueAt = (series: ISignalMonthlySeries | undefined, i: number): string => (series ? formatCount(series.buckets[i]?.value ?? 0) : '—');

  return (
    <Section title={title} note={lastMonth ? `24 месяца по ${formatMonth(lastMonth)}` : '24 месяца'}>
      <div className={styles.activity}>
        {pubs &&
          (pubs.status === 'ok' ? (
            <div className={styles.activityRow}>
              <MonthBars label="Публикации" points={pubs.buckets} forms={PUBLICATIONS} partialLast={pubs.partialLast} />
              <p className={styles.activityNote}>{coverageText(pubs, OF_PUBLICATIONS)}</p>
            </div>
          ) : (
            <p className={styles.activityNote}>Публикаций с компанией в выборке нет.</p>
          ))}
        {events &&
          (events.status === 'ok' ? (
            <div className={styles.activityRow}>
              <MonthBars label="События" points={events.buckets} forms={EVENTS} partialLast={events.partialLast} />
              <p className={styles.activityNote}>{coverageText(events, OF_EVENTS)}</p>
            </div>
          ) : (
            <p className={styles.activityNote}>Событий с компанией в выборке нет.</p>
          ))}
        <ChartData
          summary="Числа по месяцам"
          caption={title}
          columns={['Месяц', 'Публикации', 'События']}
          rows={months.map((month, i) => ({ key: month, cells: [formatMonth(month), valueAt(pubs, i), valueAt(events, i)] }))}
        />
      </div>
    </Section>
  );
};
