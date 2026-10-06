// «Показатели» во вкладке «Подробно»: три коротких списка чисел — объекты и роли, публикации, события и
// дела. Итоговой оценки нет (ADR-009): как считается число, окно и знаменатель — в пояснении «?» у подписи,
// а не раскрытием у каждого числа (06.10.2026: шестнадцать раскрывашек подряд не читались). Списки
// участий и договоров — во вкладке «Участие и связи», событий — в «Событиях».
// Числа новых правил появляются после следующего расчёта: чего нет в снимке — сказано словами (по
// отсутствию поля, не по строке версии), ничего не досчитывается.

import { FC, ReactNode } from 'react';

import type { ISignalAggregate, ISignalDate, ISignalsResponse } from '../../api/types';
import { formatCount } from '../../lib/format';
import { ASSERTION_ROLE_LABELS, COMPLETENESS_LABELS, EVENT_LABELS, formatDate, formatDateTime, formatPercent } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { DescriptionList, type IDescriptionItem } from '../ui/DescriptionList';
import { EmptyState } from '../ui/EmptyState';
import { Heading } from '../ui/Heading';
import { useCompanySignals } from './useCompanyQueries';
import styles from './CompanyDetails.module.css';

type Signals = NonNullable<ISignalsResponse['signals']>;

/** Хвост правила про внутренние номера («; id — объекты») читателю ничего не говорит. */
const ID_TAIL = /;\s*id\s+—.*$/;

/** Пояснение к числу: правило, окно, знаменатель. */
const hintOf = (aggregate: ISignalAggregate, rule?: string): string => {
  const text = (rule ?? aggregate.rule).replace(ID_TAIL, '').trim();
  const parts = [text.charAt(0).toUpperCase() + text.slice(1)];
  if (aggregate.window) {
    const basis = aggregate.window.basis === 'event_date' ? 'по дате события' : 'по дате публикации';
    parts.push(`Окно ${basis}: с ${formatDate(aggregate.window.from)} по ${formatDate(aggregate.window.to)}`);
  }
  if (aggregate.denominator !== null) parts.push(`Знаменатель — ${formatCount(aggregate.denominator)}`);
  return `${parts.join('. ')}.`;
};

const valueOf = (aggregate: ISignalAggregate, share = false): ReactNode => {
  if (aggregate.status === 'insufficient_data') return <span className={styles.insufficient}>недостаточно данных</span>;
  const value = share ? formatPercent(aggregate.value) : formatCount(aggregate.value ?? 0);
  return (
    <span className={styles.value}>
      {value}
      {aggregate.denominator !== null && ` из ${formatCount(aggregate.denominator)}`}
    </span>
  );
};

/** Строка показателя; нет числа в снимке — строки нет. */
const row = (label: string, aggregate: ISignalAggregate | undefined, options: { share?: boolean; rule?: string } = {}): IDescriptionItem[] =>
  aggregate ? [{ label, value: valueOf(aggregate, options.share), hint: hintOf(aggregate, options.rule) }] : [];

/** Разбивка «заказчик — 2 · генподрядчик — 1» одной строкой. */
const breakdown = (label: string, entries: Array<[string, ISignalAggregate]>, name: (key: string) => string, hint: string): IDescriptionItem[] =>
  entries.length === 0
    ? []
    : [{ label, value: entries.map(([key, a]) => `${name(key)} — ${formatCount(a.value ?? 0)}`).join(' · '), hint }];

const dateRow = (label: string, date: ISignalDate | undefined): IDescriptionItem[] =>
  date?.value ? [{ label, value: formatDate(date.value), hint: `${date.rule.charAt(0).toUpperCase()}${date.rule.slice(1)}.` }] : [];

const NumbersCard: FC<{ title: string; items: IDescriptionItem[] }> = ({ title, items }) => (
  <section className={styles.numbersCard}>
    <Heading className={styles.groupTitle}>{title}</Heading>
    <DescriptionList items={items} layout="inline" dense />
  </section>
);

/** Чего нет в снимке прежних правил — словами для читателя. */
const missingNumbers = (signals: Signals): string[] => {
  const missing: string[] = [];
  if (!signals.experience.contractsCount) missing.push('договоры, контрагенты, дела, события по видам');
  if (!signals.media.publicationsByMonth) missing.push('публикации и события по месяцам');
  return missing;
};

/** Причина «расчёт устарел», кроме смены правил: о ней — строкой, чего не хватает. */
const RULES_REASON = /по правилам/;

export const CompanyNumbers: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanySignals(companyId);

  if (query.isLoading) {
    return <LoadingSkeleton label="Загружаю показатели…" lines={4} height="56px" />;
  }
  if (query.isError || !query.data) {
    return (
      <Callout
        tone="danger"
        title="Показатели не загрузились"
        action={
          <Button size="sm" onClick={() => void query.refetch()}>
            Повторить
          </Button>
        }
      >
        {describeLoadError(query.error)}
      </Callout>
    );
  }

  const { refresh, signals, status } = query.data;
  if (!refresh.active) {
    return <EmptyState size="sm">Показатели ещё не посчитаны. Они появятся после первого расчёта.</EmptyState>;
  }
  const reasons = refresh.staleReasons.filter(r => !RULES_REASON.test(r));
  const missing = signals ? missingNumbers(signals) : [];

  const header = (
    <p className={styles.note}>
      Посчитано {formatDateTime(refresh.active.cutoffAt)}
      {/* raw-ok: причины — готовые фразы сервера (signals/refresh.ts) */}
      {refresh.stale && reasons.length > 0 && ` — расчёт устарел: ${reasons.join('; ')}`}.
      {missing.length > 0 && ` Появятся после следующего расчёта: ${missing.join('; ')}.`}
    </p>
  );

  if (!signals) {
    return (
      <div className={styles.panel}>
        {header}
        <EmptyState size="sm">
          {status === 'not_in_snapshot' ? 'Компания добавлена после расчёта — числа будут в следующем.' : 'Для показателей пока нет сведений.'}
        </EmptyState>
      </div>
    );
  }

  const { experience, media } = signals;
  const coverage = signals.identity.coverage;
  const legacy = coverage.legacyUnimported;
  const courts = media.courtRoles;

  const objects: IDescriptionItem[] = [
    ...row('Объектов', experience.projects),
    ...breakdown(
      'Роли',
      Object.entries(experience.byRole),
      role => ASSERTION_ROLE_LABELS[role] ?? 'другая роль',
      'Объекты, где компания названа в этой роли. Одна компания бывает в разных ролях на разных объектах.',
    ),
    ...breakdown('Работы', Object.entries(experience.byWorkPackage), wp => wp, 'Объекты, где названы работы компании.'),
    ...row('Договоров', experience.contractsCount),
    ...row('Корпоративных связей', experience.corporateCount),
    ...row('Контрагентов', experience.counterparties),
    ...row('Проверено оператором', experience.reviewed, { share: true }),
  ];

  const completeness = Object.entries(coverage.completeness);
  const publications: IDescriptionItem[] = [
    ...row('Публикаций', media.publications),
    ...row('Разных текстов', media.families, { rule: 'перепечатки одного текста считаются как один' }),
    ...row('За 90 дней', media.publications90d),
    { label: 'Источников', value: formatCount(coverage.sources), hint: 'Каналы и сайты, где найдены публикации о компании.' },
    ...dateRow('Первая', media.firstPublishedAt),
    ...dateRow('Последняя', media.latestPublishedAt),
    ...(completeness.length > 0
      ? [
          {
            label: 'Тексты',
            value: completeness.map(([k, n]) => `${COMPLETENESS_LABELS[k as keyof typeof COMPLETENESS_LABELS] ?? 'другое'} — ${formatCount(n)}`).join(' · '),
            hint: 'Полнота текста — по тому, откуда он получен, а не по длине.',
          },
        ]
      : []),
  ];

  const events: IDescriptionItem[] = [
    ...row('С датой за 12 месяцев', media.eventsDated12m),
    ...row('Без даты', media.eventsUndated),
    ...breakdown('По видам', Object.entries(media.eventsByType ?? {}), type => EVENT_LABELS[type] ?? 'прочие', 'События по виду, со слов источников.'),
    ...row('Проверено оператором', media.reviewedShare, { share: true }),
    ...row('Судебных и банкротных дел', media.legalCasesCount),
    ...(media.legalCases.length > 0
      ? [
          {
            label: 'Роль в делах',
            value: `истец или заявитель — ${formatCount(courts.plaintiff)} · ответчик или должник — ${formatCount(courts.defendant)} · не указана — ${formatCount(courts.unknown)}`,
            hint: 'Роль компании в деле — не вывод о нарушении.',
          },
        ]
      : []),
  ];

  const notes = [
    coverage.note,
    experience.note,
    media.note,
    legacy.participations + legacy.events > 0
      ? `Из прежней обработки не учтены ролей — ${formatCount(legacy.participations)}, событий — ${formatCount(legacy.events)}.`
      : '',
    media.notCounted.length > 0 ? `Не учтено как событие (план, слух или отрицание): ${formatCount(media.notCounted.length)}.` : '',
  ].filter(Boolean);

  return (
    <div className={styles.panel}>
      {header}
      <div className={styles.numbers}>
        <NumbersCard title="Объекты и роли" items={objects} />
        <NumbersCard title="Публикации" items={publications} />
        <NumbersCard title="События и дела" items={events} />
      </div>
      {/* raw-ok: пояснения — готовые фразы сервера (signals/rules.ts) */}
      <p className={styles.note}>{notes.join(' ')}</p>
    </div>
  );
};
