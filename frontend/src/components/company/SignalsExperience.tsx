// «Опыт по объектам» в показателях: числа с правилом и основанием, участия и договоры списком.
// У каждой строки — «Откуда известно» (цитата) и, у участия, «Контекст объекта»; грузятся они
// только при раскрытии.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { ICompanySignals } from '../../api/types';
import { formatCount } from '../../lib/format';
import { AMOUNT_PURPOSE_LABELS, ASSERTION_ROLE_LABELS, PRECISION_LABELS, REVIEW_LEVEL_LABELS, formatDate, formatMoney } from '../../lib/labels';
import { REVIEW_LEVEL_TONE, toneOf } from '../../lib/statusTone';
import { AssertionDetail } from '../AssertionDetail';
import { ProjectContextPanel } from '../ProjectContextPanel';
import { SignalAggregate } from '../SignalAggregate';
import { Badge } from '../ui/Badge';
import { Heading } from '../ui/Heading';
import { LazyDisclosure } from './LazyDisclosure';
import styles from '../CompanySignals.module.css';

type Experience = ICompanySignals['experience'];

const period = (from: string | null, to: string | null, precision: string): string => {
  if (!from) return 'период неизвестен';
  const range = to && to !== from ? `${formatDate(from)} — ${formatDate(to)}` : formatDate(from);
  return precision === 'day' ? range : `${range} (${PRECISION_LABELS[precision] ?? 'точность неизвестна'})`;
};

interface ISignalsExperienceProps {
  companyId: number;
  experience: Experience;
  /** Названия объектов из карточки: в расчёте показателей — только номера. */
  projectNames: Map<number, string>;
}

export const SignalsExperience: FC<ISignalsExperienceProps> = ({ companyId, experience, projectNames }) => {
  const projectName = (id: number | null): string => (id === null ? 'объект не назван' : (projectNames.get(id) ?? 'объект'));

  return (
    <section className={styles.block}>
      <Heading className={styles.blockTitle}>Опыт по объектам</Heading>
      <div className={styles.aggregates}>
        <SignalAggregate label="объектов" aggregate={experience.projects} basis="projects" />
        <SignalAggregate label="участий проверено оператором" aggregate={experience.reviewed} asShare basis="assertions" />
        {Object.entries(experience.byRole).map(([role, agg]) => (
          <SignalAggregate key={role} label={ASSERTION_ROLE_LABELS[role] ?? 'другая роль'} aggregate={agg} basis="projects" />
        ))}
        {Object.entries(experience.byWorkPackage).map(([wp, agg]) => (
          <SignalAggregate key={`wp-${wp}`} label={`работы: ${wp}`} aggregate={agg} basis="projects" />
        ))}
        {experience.contractsCount && <SignalAggregate label="договоров названо" aggregate={experience.contractsCount} basis="assertions" />}
        {experience.corporateCount && <SignalAggregate label="корпоративных связей" aggregate={experience.corporateCount} basis="assertions" />}
        {experience.counterparties && <SignalAggregate label="контрагентов названо" aggregate={experience.counterparties} basis="companies" />}
      </div>

      {experience.participations.length > 0 && (
        <ul className={styles.items}>
          {experience.participations.map(p => (
            <li key={p.assertionId} className={styles.item}>
              <p className={styles.itemLine}>
                <Link to={`/projects/${p.projectId}`} viewTransition>
                  {projectName(p.projectId)}
                </Link>{' '}
                — {ASSERTION_ROLE_LABELS[p.role] ?? 'роль не названа'}
                {p.building && `, ${p.building}`}
                {(p.workPackage ?? p.workPackageLabel) && `, ${p.workPackage ?? p.workPackageLabel}`}
              </p>
              <p className={styles.itemMeta}>
                <span>{p.validFrom ? period(p.validFrom, p.validTo, p.periodPrecision) : 'период неизвестен'}</span>
                <Badge tone={toneOf(REVIEW_LEVEL_TONE, p.review)}>{REVIEW_LEVEL_LABELS[p.review] ?? 'не проверено'}</Badge>
                {p.needsRevalidation && <Badge tone="warning">нужен пересмотр</Badge>}
              </p>
              <div className={styles.lazyRow}>
                <LazyDisclosure summary="Откуда известно">
                  <AssertionDetail assertionId={p.assertionId} showSummary={false} />
                </LazyDisclosure>
                <LazyDisclosure summary="Контекст объекта">
                  <ProjectContextPanel companyId={companyId} projectId={p.projectId} projectName={projectName(p.projectId)} />
                </LazyDisclosure>
              </div>
            </li>
          ))}
        </ul>
      )}
      {experience.notCounted.length > 0 && (
        <p className={styles.muted}>
          Не учтено как опыт (план, возможность, заявление или отрицание): {formatCount(experience.notCounted.length)}.
        </p>
      )}

      {experience.contracts.length > 0 && (
        <ul className={styles.items}>
          {experience.contracts.map(c => (
            <li key={c.assertionId} className={styles.item}>
              <p className={styles.itemLine}>
                {ASSERTION_ROLE_LABELS[c.role ?? ''] ?? 'договор'} — {c.side === 'client' ? 'заказчик по договору' : 'исполнитель по договору'}
                {c.projectId !== null && (
                  <>
                    ,{' '}
                    <Link to={`/projects/${c.projectId}`} viewTransition>
                      {projectName(c.projectId)}
                    </Link>
                  </>
                )}
              </p>
              <p className={styles.itemMeta}>
                {c.value && (
                  <span>
                    {AMOUNT_PURPOSE_LABELS[c.value.purpose ?? 'amount'] ?? 'сумма'} {formatMoney(c.value.amount, c.value.currency)}
                  </span>
                )}
                <Badge tone={toneOf(REVIEW_LEVEL_TONE, c.review)}>{REVIEW_LEVEL_LABELS[c.review] ?? 'не проверено'}</Badge>
              </p>
              <LazyDisclosure summary="Откуда известно">
                <AssertionDetail assertionId={c.assertionId} showSummary={false} />
              </LazyDisclosure>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.note}>{experience.note}</p>
    </section>
  );
};
