import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { ICompanySummary, IRegistryView, ISignalsResponse } from '../api/types';
import { IDENTITY_STATUS_LABELS, REVIEW_QUEUE_KIND_LABELS, formatDate, formatDateTime } from '../lib/labels';
import styles from './CompanyReviewOverview.module.css';

interface Props {
  companyId: number;
  registry: IRegistryView | null;
  onOpenEvidence: () => void;
}

export const CompanyReviewOverview: FC<Props> = ({ companyId, registry, onOpenEvidence }) => {
  const signals = useQuery({
    queryKey: ['company', companyId, 'signals'],
    queryFn: () => api.get<ISignalsResponse>(`/api/companies/${companyId}/signals`),
  });
  const summary = useQuery({
    queryKey: ['company', companyId, 'dossier-summary'],
    queryFn: () => api.get<ICompanySummary>(`/api/companies/${companyId}/dossier-summary`),
  });
  const identity = signals.data?.signals?.identity;
  const review = summary.data;
  const issueCount = (identity?.pendingMerges ?? 0) + (identity?.openAmbiguities ?? 0) + (review?.contradictions.length ?? 0);

  return <div className={styles.grid}>
    <section className={styles.panel} aria-labelledby="company-data-status">
      <div className={styles.head}>
        <h2 id="company-data-status">Качество сведений</h2>
        {review?.stale && <span className={styles.warning}>Срез устарел</span>}
      </div>
      {signals.isLoading || summary.isLoading ? <p className={styles.muted}>Загрузка состояния данных…</p> : null}
      {(signals.isError || summary.isError) && <p role="alert" className={styles.warning}>Часть сведений о проверке сейчас недоступна.</p>}
      {identity && <p className={styles.lead}>{IDENTITY_STATUS_LABELS[identity.status] ?? identity.status}</p>}
      {!identity && !signals.isLoading && !signals.isError && <p className={styles.lead}>Идентификация ещё не рассчитана</p>}
      {identity && <p className={styles.muted}>Источников в срезе: {identity.coverage.sources} · публикаций: {identity.coverage.publications.value ?? 'нет данных'}</p>}
      {review && <>
        <p className={issueCount > 0 ? styles.warning : styles.muted}>
          {issueCount > 0
            ? `Требуют проверки: пар на слияние ${identity?.pendingMerges ?? 0}, неоднозначностей ${identity?.openAmbiguities ?? 0}, противоречий ${review.contradictions.length}.`
            : identity ? 'Открытых вопросов проверки в текущем срезе не найдено.' : 'Состояние идентификации будет известно после расчёта сигналов.'}
        </p>
        {review.contradictions.length > 0 && <ul className={styles.issues}>
          {review.contradictions.slice(0, 3).map(item => <li key={`${item.kind}-${item.assertionId}`}>
            {REVIEW_QUEUE_KIND_LABELS[item.kind] ?? item.kind} · утверждение #{item.assertionId}
          </li>)}
        </ul>}
        {review.limits.length > 0 && <p className={styles.muted}>{review.limits[0]?.text}</p>}
        <p className={styles.meta}>Собрано {formatDateTime(review.generatedAt)}{review.signalsCutoff ? ` · срез ${formatDateTime(review.signalsCutoff)}` : ''}</p>
      </>}
      <div className={styles.actions}>
        <button type="button" onClick={onOpenEvidence}>Открыть основания</button>
        {issueCount > 0 && <Link to="/admin/review">Очередь проверки</Link>}
      </div>
    </section>

    {registry && <section className={styles.panel} aria-labelledby="company-registry">
      <div className={styles.head}><h2 id="company-registry">Сведения реестра</h2></div>
      <p className={styles.lead}>{registry.developer?.name ?? registry.groupName ?? 'Запись о застройщике'}</p>
      <p className={styles.muted}>{registry.source.title} · {registry.asOf ? `сведения на ${formatDate(registry.asOf)}` : 'дата сведений не указана'}</p>
      {registry.developer?.inn && <p className={styles.detail}>ИНН {registry.developer.inn}</p>}
      {registry.groupName && registry.developer?.name && <p className={styles.detail}>Группа: {registry.groupName}</p>}
      {registry.changes.length > 0 && <p className={styles.warning}>Есть изменения в {registry.changes.length} снимках реестра</p>}
      <p className={styles.meta}>{registry.attribution}</p>
      <button type="button" className={styles.linkButton} onClick={onOpenEvidence}>Все поля и история реестра</button>
    </section>}
  </div>;
};
