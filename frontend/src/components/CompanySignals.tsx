// «Показатели» (вкладка «Подробно»): полнота сведений, опыт по объектам, публикации и события.
// Итоговой оценки нет (ADR-009): у каждого числа — как оно считается, окно, знаменатель и
// основание. Числа новых версий правил появляются только после следующего расчёта — пока
// их нет, так и сказано, ничего не досчитывается. Чего нет — видно по самому снимку (нет поля),
// а не по строке версии: читателю номер версии ничего не говорит.

import { FC } from 'react';

import type { ISignalsResponse } from '../api/types';
import { describeLoadError } from '../lib/loadError';
import { formatDateTime } from '../lib/labels';
import { SignalsCoverage } from './company/SignalsCoverage';
import { SignalsExperience } from './company/SignalsExperience';
import { SignalsMedia } from './company/SignalsMedia';
import { useCompanySignals } from './company/useCompanyQueries';
import { LoadingSkeleton } from './LoadingSkeleton';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { EmptyState } from './ui/EmptyState';
import styles from './CompanySignals.module.css';

/** Чего нет в снимке прежних правил — словами для читателя. */
const missingNumbers = (signals: NonNullable<ISignalsResponse['signals']>): string[] => {
  const missing: string[] = [];
  if (!signals.experience.contractsCount) missing.push('договоры, контрагенты, дела, события по видам');
  if (!signals.media.publicationsByMonth) missing.push('публикации и события по месяцам');
  return missing;
};

/** Причина «расчёт устарел», кроме смены правил: о ней — отдельной строкой, чего не хватает. */
const RULES_REASON = /по правилам/;

interface ICompanySignalsProps {
  companyId: number;
  /** Названия объектов из карточки: в расчёте показателей — только номера. */
  projectNames: Map<number, string>;
}

export const CompanySignals: FC<ICompanySignalsProps> = ({ companyId, projectNames }) => {
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
  const reasons = refresh.staleReasons.filter(r => !RULES_REASON.test(r));
  const missing = signals ? missingNumbers(signals) : [];

  if (!refresh.active) {
    return <EmptyState size="sm">Показатели ещё не посчитаны. Они появятся после первого расчёта.</EmptyState>;
  }

  return (
    <div className={styles.panel}>
      <p className={styles.freshness}>Посчитано {formatDateTime(refresh.active.cutoffAt)}</p>
      {refresh.stale && reasons.length > 0 && (
        <Callout tone="warning" icon={false}>
          {/* raw-ok: причины — готовые фразы сервера (signals/refresh.ts) */}
          Расчёт устарел: {reasons.join('; ')}. Числа обновятся при следующем расчёте.
        </Callout>
      )}
      {missing.length > 0 && (
        <Callout tone="info" icon={false}>
          Часть чисел ({missing.join('; ')}) появится после следующего расчёта.
        </Callout>
      )}
      {!signals ? (
        <EmptyState size="sm">
          {status === 'not_in_snapshot'
            ? 'Компания добавлена после расчёта — числа будут в следующем.'
            : 'Для показателей пока нет сведений.'}
        </EmptyState>
      ) : (
        <>
          <SignalsCoverage coverage={signals.identity.coverage} />
          <SignalsExperience companyId={companyId} experience={signals.experience} projectNames={projectNames} />
          <SignalsMedia media={signals.media} />
        </>
      )}
    </div>
  );
};
