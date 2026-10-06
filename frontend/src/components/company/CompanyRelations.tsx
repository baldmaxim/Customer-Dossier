// «Участие и связи» во вкладке «Подробно» (06.10.2026: вместо «Резюме и противоречия» и списков
// «Показателей»). Четыре списка одной формы — объекты, договоры, корпоративные связи, совместное
// участие; у строки — «Откуда известно» и «Контекст объекта» окнами, без раскрытий под строкой.
// Договор, корпоративная связь и совместное участие — разные вещи и не сводятся в одно «связана с».
// Фразы резюме, повторявшие числа «Показателей», сняты; вопросы проверки — одной строкой сверху.

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { IStatement } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import { ASSERTION_ROLE_LABELS, ATTRIBUTION_LABELS, REVIEW_LEVEL_LABELS, REVIEW_QUEUE_KIND_LABELS } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { formatPeriod } from '../../lib/period';
import { REVIEW_LEVEL_TONE, toneOf } from '../../lib/statusTone';
import { EvidenceButton } from '../EvidenceButton';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Heading } from '../ui/Heading';
import { ProjectContextButton } from './ProjectContextButton';
import { useCompanyProjects, useCompanySignals, useCompanySummary } from './useCompanyQueries';
import styles from './CompanyDetails.module.css';

/** Атрибуция, которую не нужно повторять у каждой строки: группа и так подписана «по сообщениям источников». */
const DEFAULT_ATTRIBUTION = 'source_reported';

/** Тон ярлыка решения оператора: спорное — предупреждение, остальное — нейтрально. */
const ATTRIBUTION_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  analyst_reviewed: 'success',
  analyst_disputed: 'warning',
};

/** Фраза без вводных слов «В публикации сообщается: …» — кто стоит за ней, говорит ярлык и подпись группы. */
const bodyOf = (statement: IStatement): string => {
  const colon = statement.text.indexOf(': ');
  return colon > 0 ? statement.text.slice(colon + 2) : statement.text;
};

const Group: FC<{ title: string; caption?: string; children: ReactNode }> = ({ title, caption, children }) => (
  <section className={styles.group}>
    <div className={styles.groupHead}>
      <Heading className={styles.groupTitle}>{title}</Heading>
      {caption && <span className={styles.groupCaption}>{caption}</span>}
    </div>
    {children}
  </section>
);

const StatementRows: FC<{ items: IStatement[] }> = ({ items }) => (
  <ul className={styles.rows}>
    {items.map((s, i) => (
      <li key={`${s.assertionIds.join(',')}:${i}`} className={styles.row}>
        <div className={styles.rowMain}>
          <p className={styles.rowTitle}>{bodyOf(s)}</p>
          {s.attribution !== DEFAULT_ATTRIBUTION && (
            <p className={styles.rowMeta}>
              <Badge tone={ATTRIBUTION_TONE[s.attribution] ?? 'neutral'}>{ATTRIBUTION_LABELS[s.attribution] ?? 'решение оператора'}</Badge>
            </p>
          )}
        </div>
        <div className={styles.rowActions}>
          <EvidenceButton assertionIds={s.assertionIds} quotes={s.quotes} lead={bodyOf(s)} />
        </div>
      </li>
    ))}
  </ul>
);

export const CompanyRelations: FC<{ companyId: number }> = ({ companyId }) => {
  const canReview = useCan('admin.view');
  const signals = useCompanySignals(companyId);
  const summary = useCompanySummary(companyId);
  const projects = useCompanyProjects(companyId);
  const projectNames = new Map((projects.data?.items ?? []).map(p => [p.id, p.name]));
  const projectName = (id: number): string => projectNames.get(id) ?? 'объект';

  if (summary.isLoading || signals.isLoading) {
    return <LoadingSkeleton label="Загружаю участие и связи…" lines={4} height="48px" />;
  }
  if (summary.isError || !summary.data) {
    return (
      <Callout
        tone="danger"
        title="Участие и связи не загрузились"
        action={
          <Button size="sm" onClick={() => void summary.refetch()}>
            Повторить
          </Button>
        }
      >
        {describeLoadError(summary.error)}
      </Callout>
    );
  }

  const experience = signals.data?.signals?.experience ?? null;
  const participations = experience?.participations ?? [];
  const notCounted = experience?.notCounted.length ?? 0;
  const { contracts, corporate, coParticipants } = summary.data.counterparties;
  const contradictions = summary.data.contradictions;
  const issues = Object.entries(
    contradictions.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.kind]: (acc[c.kind] ?? 0) + 1 }), {}),
  ).map(([kind, n]) => `${REVIEW_QUEUE_KIND_LABELS[kind] ?? 'вопрос проверки'} — ${formatCount(n)}`);
  const noLinks = contracts.length === 0 && corporate.length === 0 && coParticipants.length === 0;

  return (
    <div className={styles.panel}>
      {issues.length > 0 && (
        <Callout
          tone="warning"
          title="Нужна проверка"
          action={
            canReview ? (
              <ButtonLink to="/admin/review" size="sm">
                Открыть «Проверку»
              </ButtonLink>
            ) : undefined
          }
        >
          {/* raw-ok: виды вопросов — подписи из REVIEW_QUEUE_KIND_LABELS */}
          По сведениям о компании открыты вопросы: {issues.join(', ')}.
        </Callout>
      )}

      <Group title="Объекты" caption="участие по сообщениям источников">
        {participations.length > 0 ? (
          <ul className={styles.rows}>
            {participations.map(p => {
              const name = projectName(p.projectId);
              const period = formatPeriod(p.validFrom, p.validTo, p.periodPrecision);
              return (
                <li key={p.assertionId} className={styles.row}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>
                      <Link to={`/projects/${p.projectId}`} viewTransition>
                        {name}
                      </Link>{' '}
                      — {ASSERTION_ROLE_LABELS[p.role] ?? 'роль не названа'}
                      {p.building && `, ${p.building}`}
                      {(p.workPackage ?? p.workPackageLabel) && `, ${p.workPackage ?? p.workPackageLabel}`}
                    </p>
                    <p className={styles.rowMeta}>
                      <span>{period || 'период неизвестен'}</span>
                      {p.review !== 'text_grounded' && <Badge tone={toneOf(REVIEW_LEVEL_TONE, p.review)}>{REVIEW_LEVEL_LABELS[p.review] ?? 'не проверено'}</Badge>}
                      {p.needsRevalidation && <Badge tone="warning">нужен пересмотр</Badge>}
                    </p>
                  </div>
                  <div className={styles.rowActions}>
                    <EvidenceButton assertionIds={[p.assertionId]} lead={`${name} — ${ASSERTION_ROLE_LABELS[p.role] ?? 'роль не названа'}`} />
                    <ProjectContextButton companyId={companyId} projectId={p.projectId} projectName={name} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState size="sm" icon={false}>
            {experience
              ? 'Участие в объектах в собранных публикациях не найдено.'
              : 'Список участий появится после расчёта показателей.'}
          </EmptyState>
        )}
        {notCounted > 0 && (
          <p className={styles.note}>Не учтено как участие (план, возможность, заявление или отрицание): {formatCount(notCounted)}.</p>
        )}
      </Group>

      {contracts.length > 0 && (
        <Group title="Договоры" caption="по сообщениям источников">
          <StatementRows items={contracts} />
        </Group>
      )}
      {corporate.length > 0 && (
        <Group title="Корпоративные связи" caption="по сообщениям источников">
          <StatementRows items={corporate} />
        </Group>
      )}
      {coParticipants.length > 0 && (
        <Group title="Вместе на объектах" caption="это не договор: две фирмы на одном объекте могут не иметь отношений">
          <ul className={styles.rows}>
            {coParticipants.map(c => (
              <li key={`${c.companyId}-${c.projectId}`} className={styles.row}>
                <p className={styles.rowTitle}>
                  <Link to={`/company/${c.companyId}`} viewTransition>
                    {c.companyName}
                  </Link>{' '}
                  ({ASSERTION_ROLE_LABELS[c.roleOther ?? ''] ?? 'роль не названа'}) —{' '}
                  <Link to={`/projects/${c.projectId}`} viewTransition>
                    {c.projectName}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </Group>
      )}
      {noLinks && <p className={styles.note}>Договоров, корпоративных связей и совместного участия в собранных публикациях нет.</p>}
    </div>
  );
};
