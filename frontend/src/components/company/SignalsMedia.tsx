// «Публикации и события» в показателях. Перепечатки — публикации, а не независимые
// подтверждения: разных текстов обычно меньше, чем публикаций. Роль в деле — не вывод о
// нарушении; суммы не складываются.

import { FC } from 'react';

import type { ICompanySignals } from '../../api/types';
import { formatCount } from '../../lib/format';
import {
  AMOUNT_PURPOSE_LABELS,
  DATE_STATUS_LABELS,
  EVENT_LABELS,
  EVENT_OUTCOME_LABELS,
  EVENT_STAGE_LABELS,
  PRECISION_LABELS,
  PROCEDURAL_ROLE_LABELS,
  REVIEW_LEVEL_LABELS,
  formatDate,
  formatMoney,
} from '../../lib/labels';
import { REVIEW_LEVEL_TONE, toneOf } from '../../lib/statusTone';
import { AssertionDetail } from '../AssertionDetail';
import { SignalAggregate } from '../SignalAggregate';
import { SignalDate } from '../SignalDate';
import { Badge } from '../ui/Badge';
import { Heading } from '../ui/Heading';
import { LazyDisclosure } from './LazyDisclosure';
import styles from '../CompanySignals.module.css';

type Media = ICompanySignals['media'];

const period = (from: string | null, to: string | null, precision: string): string => {
  if (!from) return 'дата неизвестна';
  const range = to && to !== from ? `${formatDate(from)} — ${formatDate(to)}` : formatDate(from);
  return precision === 'day' ? range : `${range} (${PRECISION_LABELS[precision] ?? 'точность неизвестна'})`;
};

export const SignalsMedia: FC<{ media: Media }> = ({ media }) => (
  <section className={styles.block}>
    <Heading className={styles.blockTitle}>Публикации и события</Heading>
    <div className={styles.aggregates}>
      <SignalAggregate label="публикаций (перепечатки отдельно)" aggregate={media.publications} basis="publications" />
      <SignalAggregate label="разных текстов (перепечатки — как один)" aggregate={media.families} basis="families" />
      <SignalAggregate label="первоисточник известен" aggregate={media.familiesByOrigin.established} basis="families" />
      <SignalAggregate label="первоисточник неизвестен" aggregate={media.familiesByOrigin.unknown} basis="families" />
      <SignalAggregate label="публикаций за 90 дней" aggregate={media.publications90d} basis="publications" />
      <SignalAggregate label="событий с датой за 12 месяцев" aggregate={media.eventsDated12m} basis="assertions" />
      <SignalAggregate label="событий без даты" aggregate={media.eventsUndated} basis="assertions" />
      <SignalAggregate label="без даты, опубликованы за 90 дней" aggregate={media.eventsUndatedPublished90d} basis="assertions" />
      <SignalAggregate label="событий проверено оператором" aggregate={media.reviewedShare} asShare basis="assertions" />
      {media.firstPublishedAt && <SignalDate label="первая публикация" date={media.firstPublishedAt} />}
      {media.latestPublishedAt && <SignalDate label="последняя публикация" date={media.latestPublishedAt} />}
      {media.legalCasesCount && <SignalAggregate label="судебных и банкротных дел" aggregate={media.legalCasesCount} basis="assertions" />}
      {media.publicationsByMonth && (
        <SignalAggregate label="публикаций в ряду по месяцам (24 мес.)" aggregate={media.publicationsByMonth} basis="publications" />
      )}
      {media.eventsByMonth && <SignalAggregate label="событий в ряду по месяцам (24 мес.)" aggregate={media.eventsByMonth} basis="assertions" />}
      {Object.entries(media.eventsByType ?? {}).map(([type, agg]) => (
        <SignalAggregate key={`et-${type}`} label={`событий: ${EVENT_LABELS[type] ?? 'прочие'}`} aggregate={agg} basis="assertions" />
      ))}
    </div>

    {media.events.length > 0 && (
      <ul className={styles.items}>
        {media.events.map(e => (
          <li key={e.assertionId} className={styles.item}>
            <p className={styles.itemLine}>
              По сообщению источника: <strong>{EVENT_LABELS[e.type] ?? 'событие'}</strong>
              {e.proceduralRole && ` · компания — ${PROCEDURAL_ROLE_LABELS[e.proceduralRole] ?? 'участник'}`}
              {e.stage && ` · ${EVENT_STAGE_LABELS[e.stage] ?? 'стадия не описана'}`}
              {e.outcome && ` · итог по источнику: ${EVENT_OUTCOME_LABELS[e.outcome] ?? 'не описан'}`}
              {e.value && (
                <>
                  {' · '}
                  <span>
                    {AMOUNT_PURPOSE_LABELS[e.value.purpose ?? 'amount'] ?? 'сумма'} {formatMoney(e.value.amount, e.value.currency)}
                  </span>
                </>
              )}
            </p>
            <p className={styles.itemMeta}>
              <span>{period(e.validFrom, e.validTo, e.periodPrecision)}</span>
              <span>{DATE_STATUS_LABELS[e.dateStatus] ?? ''}</span>
              <span>
                публикаций — {formatCount(e.publications)}, разных текстов — {formatCount(e.families)}
              </span>
              <Badge tone={toneOf(REVIEW_LEVEL_TONE, e.review)}>{REVIEW_LEVEL_LABELS[e.review] ?? 'не проверено'}</Badge>
              {e.needsRevalidation && <Badge tone="warning">нужен пересмотр</Badge>}
            </p>
            <LazyDisclosure summary="Откуда известно">
              <AssertionDetail assertionId={e.assertionId} showSummary={false} />
            </LazyDisclosure>
          </li>
        ))}
      </ul>
    )}
    {media.legalCases.length > 0 && (
      <p className={styles.muted}>
        Дел — {formatCount(media.legalCases.length)}: компания истец или заявитель — {formatCount(media.courtRoles.plaintiff)},
        ответчик или должник — {formatCount(media.courtRoles.defendant)}, роль не указана — {formatCount(media.courtRoles.unknown)}.
        Роль в деле — не вывод о нарушении.
      </p>
    )}
    {media.notCounted.length > 0 && (
      <p className={styles.muted}>Не учтено как событие (план, слух или отрицание): {formatCount(media.notCounted.length)}.</p>
    )}
    <p className={styles.note}>{media.note}</p>
  </section>
);
