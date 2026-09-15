import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { ISignalsResponse } from '../api/types';
import {
  AMOUNT_PURPOSE_LABELS,
  ASSERTION_ROLE_LABELS,
  COMPLETENESS_LABELS,
  DATE_STATUS_LABELS,
  EVENT_LABELS,
  EVENT_OUTCOME_LABELS,
  EVENT_STAGE_LABELS,
  IDENTITY_STATUS_LABELS,
  IDENTIFIER_TYPE_LABELS,
  PRECISION_LABELS,
  PROCEDURAL_ROLE_LABELS,
  REVIEW_LEVEL_LABELS,
  formatDate,
  formatDateTime,
} from '../lib/labels';
import { AssertionDetail } from './AssertionDetail';
import { ProjectContextPanel } from './ProjectContextPanel';
import { SignalAggregate } from './SignalAggregate';
import styles from './CompanySignals.module.css';

interface ICompanySignalsProps {
  companyId: number;
  /** Названия объектов из карточки: в снимке — только id. */
  projectNames: Map<number, string>;
}

const datePart = (from: string | null, to: string | null, precision: string): string => {
  if (!from) return 'дата неизвестна';
  const range = to && to !== from ? `${formatDate(from)} — ${formatDate(to)}` : formatDate(from);
  return precision === 'day' ? range : `${range} (${PRECISION_LABELS[precision] ?? precision})`;
};

/**
 * Объяснимые сигналы (этап 07): идентификация и полнота, опыт, публикации и события, контекст объекта.
 * Итоговой оценки нет: у каждого числа — правило, окно, знаменатель и исходные id.
 */
export const CompanySignals: FC<ICompanySignalsProps> = ({ companyId, projectNames }) => {
  const [openAssertion, setOpenAssertion] = useState<number | null>(null);
  const [contextProject, setContextProject] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['company', companyId, 'signals'],
    queryFn: () => api.get<ISignalsResponse>(`/api/companies/${companyId}/signals`),
  });

  if (query.isLoading) return <p className={styles.muted}>Загрузка сигналов…</p>;
  if (query.isError || !query.data) return <p className={styles.muted}>Сигналы недоступны.</p>;
  const { refresh, signals, status } = query.data;

  const freshness = (
    <div className={styles.freshness} role="status">
      {refresh.active ? (
        <span>
          Срез {formatDateTime(refresh.active.cutoffAt)} · правила {refresh.active.rulesVersion}
        </span>
      ) : (
        <span>Сигналы ещё не рассчитывались (npm run metrics:refresh).</span>
      )}
      {refresh.stale && refresh.active && <span className={styles.stale}>Устарело: {refresh.staleReasons.join('; ')}</span>}
    </div>
  );

  if (!signals) {
    return (
      <section className={styles.panel}>
        {freshness}
        <p className={styles.muted}>
          {status === 'not_in_snapshot' ? 'Компания появилась после среза — будет в следующем пересчёте.' : 'Данных для сигналов нет.'}
        </p>
      </section>
    );
  }

  const { identity, experience, media } = signals;
  const projectName = (id: number | null): string => (id === null ? '—' : (projectNames.get(id) ?? `объект #${id}`));
  const toggle = (id: number): void => setOpenAssertion(openAssertion === id ? null : id);

  return (
    <section className={styles.panel} aria-label="Сигналы компании">
      {freshness}

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Идентификация и полнота данных</h3>
        <p className={styles.lead}>{IDENTITY_STATUS_LABELS[identity.status] ?? identity.status}</p>
        <p className={styles.muted}>
          {Object.entries(identity.identifiers)
            .map(([type, n]) => `${IDENTIFIER_TYPE_LABELS[type] ?? type}: ${n}`)
            .join(', ') || 'реквизитов нет'}
          {identity.pendingMerges > 0 && ` · пар на слияние: ${identity.pendingMerges}`}
          {identity.openAmbiguities > 0 && ` · открытых неоднозначностей: ${identity.openAmbiguities}`}
        </p>
        <div className={styles.aggregates}>
          <SignalAggregate label="публикаций в выборке" aggregate={identity.coverage.publications} idsLabel="Публикации" />
        </div>
        <p className={styles.muted}>
          Источников: {identity.coverage.sources}
          {Object.entries(identity.coverage.completeness).map(([k, n]) => ` · ${COMPLETENESS_LABELS[k as keyof typeof COMPLETENESS_LABELS] ?? k}: ${n}`)}
        </p>
        {(identity.coverage.legacyUnimported.participations > 0 || identity.coverage.legacyUnimported.events > 0) && (
          <p className={styles.stale}>
            Старый разбор не перенесён в утверждения: ролей {identity.coverage.legacyUnimported.participations}, событий{' '}
            {identity.coverage.legacyUnimported.events} — в сигналах не учтены.
          </p>
        )}
        <p className={styles.note}>{identity.coverage.note}</p>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Опыт по объектам</h3>
        <div className={styles.aggregates}>
          <SignalAggregate label="объектов" aggregate={experience.projects} idsLabel="Объекты" />
          <SignalAggregate label="участий проверено аналитиком" aggregate={experience.reviewed} asShare idsLabel="Утверждения" />
          {Object.entries(experience.byRole).map(([role, agg]) => (
            <SignalAggregate key={role} label={ASSERTION_ROLE_LABELS[role] ?? role} aggregate={agg} idsLabel="Объекты" />
          ))}
        </div>
        {experience.participations.length > 0 && (
          <ul className={styles.list}>
            {experience.participations.map(p => (
              <li key={p.assertionId}>
                <button type="button" className={styles.linkButton} onClick={() => toggle(p.assertionId)}>
                  {projectName(p.projectId)}
                </button>{' '}
                — {ASSERTION_ROLE_LABELS[p.role] ?? p.role}
                {p.building && `, ${p.building}`}
                {(p.workPackage ?? p.workPackageLabel) && `, ${p.workPackage ?? p.workPackageLabel}`}
                <span className={styles.meta}>
                  {' '}
                  · {p.validFrom ? datePart(p.validFrom, p.validTo, p.periodPrecision) : 'период неизвестен'} · {REVIEW_LEVEL_LABELS[p.review]}
                  {p.needsRevalidation && ' · нужен пересмотр'}
                </span>{' '}
                <button type="button" className={styles.linkButton} onClick={() => setContextProject(contextProject === p.projectId ? null : p.projectId)}>
                  контекст объекта
                </button>
                {contextProject === p.projectId && (
                  <ProjectContextPanel companyId={companyId} projectId={p.projectId} projectName={projectName(p.projectId)} />
                )}
                {openAssertion === p.assertionId && <AssertionDetail assertionId={p.assertionId} />}
              </li>
            ))}
          </ul>
        )}
        {experience.notCounted.length > 0 && (
          <p className={styles.muted}>Не учтено как опыт (план, возможность, заявление или отрицание): {experience.notCounted.length}.</p>
        )}
        {experience.contracts.length > 0 && (
          <ul className={styles.list}>
            {experience.contracts.map(c => (
              <li key={c.assertionId}>
                <button type="button" className={styles.linkButton} onClick={() => toggle(c.assertionId)}>
                  {ASSERTION_ROLE_LABELS[c.role ?? ''] ?? c.role}
                </button>{' '}
                — {c.side === 'client' ? 'заказчик по договору' : 'исполнитель по договору'}
                {c.projectId !== null && `, ${projectName(c.projectId)}`}
                {c.value && ` · ${AMOUNT_PURPOSE_LABELS[c.value.purpose ?? 'amount'] ?? 'сумма'} ${c.value.amount} ${c.value.currency ?? '(валюта не указана)'}`}
                <span className={styles.meta}> · {REVIEW_LEVEL_LABELS[c.review]}</span>
                {openAssertion === c.assertionId && <AssertionDetail assertionId={c.assertionId} />}
              </li>
            ))}
          </ul>
        )}
        <p className={styles.note}>{experience.note}</p>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Публикации и события</h3>
        <div className={styles.aggregates}>
          <SignalAggregate label="публикаций (перепечатки отдельно)" aggregate={media.publications} idsLabel="Публикации" />
          <SignalAggregate label="семей одинакового текста" aggregate={media.families} idsLabel="Первые публикации семей" />
          <SignalAggregate label="с установленным первоисточником" aggregate={media.familiesByOrigin.established} idsLabel="Семьи" />
          <SignalAggregate label="происхождение не установлено" aggregate={media.familiesByOrigin.unknown} idsLabel="Семьи" />
          <SignalAggregate label="публикаций за 90 дней" aggregate={media.publications90d} idsLabel="Публикации" />
          <SignalAggregate label="событий с датой за 12 месяцев" aggregate={media.eventsDated12m} idsLabel="Утверждения" />
          <SignalAggregate label="событий без даты" aggregate={media.eventsUndated} idsLabel="Утверждения" />
          <SignalAggregate label="без даты, опубликованы за 90 дней" aggregate={media.eventsUndatedPublished90d} idsLabel="Утверждения" />
          <SignalAggregate label="событий проверено аналитиком" aggregate={media.reviewedShare} asShare idsLabel="Утверждения" />
        </div>
        {media.events.length > 0 && (
          <ul className={styles.list}>
            {media.events.map(e => (
              <li key={e.assertionId}>
                По сообщению источника:{' '}
                <button type="button" className={styles.linkButton} onClick={() => toggle(e.assertionId)}>
                  {EVENT_LABELS[e.type] ?? e.type}
                </button>
                {e.proceduralRole && ` · компания — ${PROCEDURAL_ROLE_LABELS[e.proceduralRole] ?? e.proceduralRole}`}
                {e.stage && ` · ${EVENT_STAGE_LABELS[e.stage] ?? e.stage}`}
                {e.outcome && ` · результат по источнику: ${EVENT_OUTCOME_LABELS[e.outcome] ?? e.outcome}`}
                {e.value && ` · ${AMOUNT_PURPOSE_LABELS[e.value.purpose ?? 'amount'] ?? 'сумма'} ${e.value.amount} ${e.value.currency ?? ''}`}
                <span className={styles.meta}>
                  {' '}
                  · {datePart(e.validFrom, e.validTo, e.periodPrecision)} · {DATE_STATUS_LABELS[e.dateStatus]} · публикаций {e.publications}, семей{' '}
                  {e.families} · {REVIEW_LEVEL_LABELS[e.review]}
                  {e.needsRevalidation && ' · нужен пересмотр'}
                </span>
                {openAssertion === e.assertionId && <AssertionDetail assertionId={e.assertionId} />}
              </li>
            ))}
          </ul>
        )}
        {media.legalCases.length > 0 && (
          <p className={styles.muted}>
            Дел: {media.legalCases.length} · компания истец или заявитель: {media.courtRoles.plaintiff}, ответчик или должник:{' '}
            {media.courtRoles.defendant}, роль не указана: {media.courtRoles.unknown}. Роль в деле — не вывод о нарушении.
          </p>
        )}
        {media.notCounted.length > 0 && <p className={styles.muted}>Не учтено как событие (план, слух или отрицание): {media.notCounted.length}.</p>}
        <p className={styles.note}>{media.note}</p>
      </div>
    </section>
  );
};
