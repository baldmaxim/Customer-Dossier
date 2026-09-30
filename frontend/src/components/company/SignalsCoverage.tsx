// «Полнота сведений» в показателях: сколько публикаций и источников, какие тексты полные.
// Опознание (ИНН, дубли, неясные упоминания) — отдельным разделом «Опознание», здесь не повторяется.

import { FC } from 'react';

import type { ICompanySignals } from '../../api/types';
import { formatCount } from '../../lib/format';
import { COMPLETENESS_LABELS } from '../../lib/labels';
import { SignalAggregate } from '../SignalAggregate';
import { Heading } from '../ui/Heading';
import styles from '../CompanySignals.module.css';

type Coverage = ICompanySignals['identity']['coverage'];

export const SignalsCoverage: FC<{ coverage: Coverage }> = ({ coverage }) => {
  const completeness = Object.entries(coverage.completeness)
    .map(([k, n]) => `${COMPLETENESS_LABELS[k as keyof typeof COMPLETENESS_LABELS] ?? 'другое'} — ${formatCount(n)}`)
    .join(', ');
  const legacy = coverage.legacyUnimported;

  return (
    <section className={styles.block}>
      <Heading className={styles.blockTitle}>Полнота сведений</Heading>
      <div className={styles.aggregates}>
        <SignalAggregate label="публикаций найдено" aggregate={coverage.publications} basis="publications" />
      </div>
      <p className={styles.muted}>
        Источников — {formatCount(coverage.sources)}
        {completeness && `; тексты: ${completeness}`}.
      </p>
      {(legacy.participations > 0 || legacy.events > 0) && (
        <p className={styles.muted}>
          Из прежней обработки не учтены ролей — {formatCount(legacy.participations)}, событий — {formatCount(legacy.events)}.
        </p>
      )}
      <p className={styles.note}>{coverage.note}</p>
    </section>
  );
};
