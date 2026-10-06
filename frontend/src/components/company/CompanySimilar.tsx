// «Похожие компании — возможно, это она же: …» одной строкой под шапкой карточки.
// Портал не объединяет похожие карточки сам (объединить легко, разделить почти нельзя),
// поэтому говорит о них прямо — чтобы читатель не принял половину сведений за все. Пары из очереди
// «возможный дубль» (в т. ч. одно название в разной записи: Сминекс — Sminex) — с вердиктом модели.

import { FC, Fragment } from 'react';
import { Link } from 'react-router-dom';

import { MODEL_VERDICT_HINTS } from '../../lib/labels';
import { Callout } from '../ui/Callout';
import { useCompanySimilar } from './useCompanyQueries';
import styles from './Company.module.css';

export const CompanySimilar: FC<{ companyId: number }> = ({ companyId }) => {
  const similar = useCompanySimilar(companyId).data?.items ?? [];
  if (similar.length === 0) return null;
  return (
    <Callout tone="info" icon={false} className={styles.similar}>
      {/* Одна фраза одним абзацем: ссылки — часть предложения, а не отдельные мелкие цели. */}
      <p className={styles.similarText}>
        <span className={styles.similarLead}>Похожие компании — возможно, это она же: </span>
        {similar.map((s, i) => (
          <Fragment key={s.id}>
            {i > 0 && ', '}
            <Link to={`/company/${s.id}`} viewTransition>
              {s.name}
            </Link>
            {s.city ? ` (${s.city})` : ''}
            {s.modelVerdict === 'same' && ` — ${MODEL_VERDICT_HINTS.same}`}
          </Fragment>
        ))}
        .
      </p>
    </Callout>
  );
};
