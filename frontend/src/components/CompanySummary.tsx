// «Резюме и противоречия» (вкладка «Подробно»): фразы шаблоном по опубликованным сведениям —
// каждая с тем, кто за ней стоит («в публикации сообщается», «проверено оператором»); договоры,
// корпоративные связи и совместное участие — раздельно; открытые противоречия; чего в собранных
// публикациях нет. Ссылка в «Проверку» — только тем, кому доступна админка.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import { useCan } from '../hooks/useAuth';
import { ASSERTION_ROLE_LABELS, REVIEW_QUEUE_KIND_LABELS, formatDateTime } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { useCompanySummary } from './company/useCompanyQueries';
import { StatementList } from './StatementList';
import { LoadingSkeleton } from './LoadingSkeleton';
import { Button } from './ui/Button';
import { ButtonLink } from './ui/ButtonLink';
import { Callout } from './ui/Callout';
import { Heading } from './ui/Heading';
import { deeper, useHeadingLevel } from './ui/headingLevel';
import styles from './CompanySummary.module.css';

export const CompanySummary: FC<{ companyId: number }> = ({ companyId }) => {
  const canReview = useCan('admin.view');
  const query = useCompanySummary(companyId);
  // Части резюме — заголовки уровня раздела, их подпункты — на уровень глубже.
  const subLevel = deeper(useHeadingLevel());

  if (query.isLoading) {
    return <LoadingSkeleton label="Собираю резюме…" lines={4} />;
  }
  if (query.isError || !query.data) {
    return (
      <Callout
        tone="danger"
        title="Резюме не загрузилось"
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
  const s = query.data;
  const { contracts, corporate, coParticipants } = s.counterparties;

  return (
    <div className={styles.summary}>
      <p className={styles.meta}>
        Собрано {formatDateTime(s.generatedAt)}
        {s.signalsCutoff ? `; показатели посчитаны ${formatDateTime(s.signalsCutoff)}` : ''}
        {s.stale ? ' — расчёт устарел, часть сведений новее его' : ''}.
      </p>

      <section className={styles.part}>
        <Heading className={styles.title}>Коротко</Heading>
        <StatementList items={s.summary} empty="Сведений для резюме пока нет." />
      </section>

      <section className={styles.part}>
        <Heading className={styles.title}>Договоры и связи</Heading>
        <Heading level={subLevel} className={styles.subtitle}>
              Договоры — по сообщениям источников
            </Heading>
        <StatementList items={contracts} empty="Договоров с участием компании в собранных публикациях нет." />
        {corporate.length > 0 && (
          <>
            <Heading level={subLevel} className={styles.subtitle}>
              Корпоративные связи
            </Heading>
            <StatementList items={corporate} />
          </>
        )}
        <Heading level={subLevel} className={styles.subtitle}>
              Вместе на объектах (это не договор)
            </Heading>
        {coParticipants.length === 0 ? (
          <p className={styles.meta}>Нет.</p>
        ) : (
          <ul className={styles.list}>
            {coParticipants.map(c => (
              <li key={`${c.companyId}-${c.projectId}`}>
                <Link to={`/company/${c.companyId}`} viewTransition>
                  {c.companyName}
                </Link>{' '}
                ({ASSERTION_ROLE_LABELS[c.roleOther ?? ''] ?? 'роль не названа'}) на{' '}
                <Link to={`/projects/${c.projectId}`} viewTransition>
                  {c.projectName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.part}>
        <Heading className={styles.title}>Противоречия</Heading>
        {s.contradictions.length === 0 ? (
          <p className={styles.meta}>Открытых противоречий по сведениям о компании нет.</p>
        ) : (
          <>
            <ul className={styles.list}>
              {s.contradictions.map(c => (
                <li key={`${c.kind}-${c.assertionId}`}>{REVIEW_QUEUE_KIND_LABELS[c.kind] ?? 'вопрос проверки'}</li>
              ))}
            </ul>
            {canReview && (
              <ButtonLink to="/admin/review" variant="link" size="sm">
                Разобрать в «Проверке»
              </ButtonLink>
            )}
          </>
        )}
      </section>

      {s.limits.length > 0 && (
        <section className={styles.part}>
          <Heading className={styles.title}>Чего в собранных публикациях нет</Heading>
          <StatementList items={s.limits} />
        </section>
      )}
    </div>
  );
};
