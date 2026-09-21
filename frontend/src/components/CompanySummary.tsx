import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { ICompanySummary } from '../api/types';
import { ASSERTION_ROLE_LABELS, REVIEW_QUEUE_KIND_LABELS, formatDateTime } from '../lib/labels';
import styles from '../pages/Dossier.module.css';
import { StatementList } from './StatementList';

/** Верх досье компании: резюме шаблонами, контрагенты по типу связи, противоречия, ограничения выборки, обращения. */
export const CompanySummary: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useQuery({
    queryKey: ['company', companyId, 'dossier-summary'],
    queryFn: () => api.get<ICompanySummary>(`/api/companies/${companyId}/dossier-summary`),
  });
  if (query.isLoading) return <p className={styles.meta}>Загрузка резюме…</p>;
  if (query.isError || !query.data) {
    return (
      <p className={styles.error} role="alert">
        Резюме недоступно: {(query.error as Error | null)?.message ?? 'нет данных'}
      </p>
    );
  }
  const s = query.data;

  return (
    <div className={styles.page}>
      <section className={styles.section} aria-labelledby="summary">
        <div className={styles.row}>
          <h2 id="summary" className={styles.sectionTitle}>Резюме</h2>
        </div>
        <p className={s.stale ? styles.warn : styles.meta}>
          Собрано {formatDateTime(s.generatedAt)}
          {s.signalsCutoff ? ` · срез сигналов ${formatDateTime(s.signalsCutoff)}` : ''}
          {s.stale && s.staleReasons.length > 0 ? ` · устарело: ${s.staleReasons.join('; ')}` : ''}
        </p>
        <StatementList items={s.summary} />
      </section>

      <div className={styles.columns}>
        <section className={styles.section} aria-labelledby="counterparties">
          <h2 id="counterparties" className={styles.sectionTitle}>Контрагенты и типы связей</h2>
          <h3 className={styles.sectionTitle}>Договоры (прямое основание)</h3>
          <StatementList items={s.counterparties.contracts} empty="Договоров с участием компании в выборке нет." />
          {s.counterparties.corporate.length > 0 && (
            <>
              <h3 className={styles.sectionTitle}>Корпоративные связи</h3>
              <StatementList items={s.counterparties.corporate} />
            </>
          )}
          <h3 className={styles.sectionTitle}>Совместное участие на объектах (не договор)</h3>
          {s.counterparties.coParticipants.length === 0 ? (
            <p className={styles.meta}>Нет.</p>
          ) : (
            <ul className={styles.list}>
              {s.counterparties.coParticipants.map(c => (
                <li key={`${c.companyId}-${c.projectId}`} className={styles.listItem}>
                  <Link to={`/company/${c.companyId}`}>{c.companyName}</Link> ({ASSERTION_ROLE_LABELS[c.roleOther ?? ''] ?? c.roleOther ?? 'роль не указана'}) на{' '}
                  <Link to={`/projects/${c.projectId}`}>{c.projectName}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="contradictions">
          <h2 id="contradictions" className={styles.sectionTitle}>Противоречия и непроверенное</h2>
          {s.contradictions.length === 0 ? (
            <p className={styles.meta}>Открытых противоречий по сведениям о компании нет.</p>
          ) : (
            <ul className={styles.list}>
              {s.contradictions.map(c => (
                <li key={`${c.kind}-${c.assertionId}`} className={styles.listItem}>
                  {REVIEW_QUEUE_KIND_LABELS[c.kind] ?? c.kind} · утверждение #{c.assertionId} · <Link to="/admin/review">в очередь проверки</Link>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.sectionTitle}>Ограничения выборки</h3>
          <StatementList items={s.limits} />
        </section>
      </div>
    </div>
  );
};
