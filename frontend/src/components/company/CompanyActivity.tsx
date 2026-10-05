// «Публикации и события по месяцам» на вкладке «Сведения» (signals@3, 05.10.2026). Два ряда — два графика
// на одной оси месяцев, у каждого своя шкала (dual-axis на одном графике выдумал бы связь рядов). Ряды
// посчитаны правилами снимка показателей: здесь только форма, сумма и что не вошло — словами (без даты,
// раньше окна, снимки ДОМ.РФ, даты до квартала). Это форма потока сведений, а не оценка компании (ADR-009):
// всплеск публикаций — повод открыть публикации, не вывод.
//
// Снимок прежних правил рядов не содержит — так и сказано, ничего не досчитывается; показатели не посчитаны —
// блока нет (это говорит «Источники и даты»).

import { FC } from 'react';

import type { ISignalMonthlySeries } from '../../api/types';
import { formatCount, formatCountWord, type PluralForms } from '../../lib/format';
import { formatDate, formatMonth } from '../../lib/labels';
import { ChartData } from '../charts/ChartData';
import { MonthBars } from '../charts/MonthBars';
import { Section } from '../ui/Section';
import { useCompanySignals } from './useCompanyQueries';
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
  const query = useCompanySignals(companyId);
  const data = query.data;
  if (!data?.refresh.active || !data.signals) return null;
  const pubs = data.signals.media.publicationsByMonth;
  const events = data.signals.media.eventsByMonth;
  const title = 'Публикации и события по месяцам';

  if (!pubs && !events) {
    return (
      <Section title={title}>
        <p className={styles.structureMissing}>Помесячные числа появятся после следующего расчёта показателей.</p>
      </Section>
    );
  }

  const months = (pubs ?? events)!.buckets.map(b => b.month);
  const valueAt = (series: ISignalMonthlySeries | undefined, i: number): string => (series ? formatCount(series.buckets[i]?.value ?? 0) : '—');

  return (
    <Section title={title} note={`24 месяца по ${formatDate(data.signals.cutoff)}`}>
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
