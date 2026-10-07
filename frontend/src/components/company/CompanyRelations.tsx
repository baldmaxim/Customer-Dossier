// «Участие и связи» во вкладке «Подробно» (06.10.2026: вместо «Резюме и противоречия» и списков
// «Показателей»). Четыре списка одной формы — объекты, договоры, корпоративные связи, совместное
// участие; у строки — «Откуда известно» и «Контекст объекта» окнами, без раскрытий под строкой.
// Договор, корпоративная связь и совместное участие — разные вещи и не сводятся в одно «связана с».
//
// Один источник на список (07.10.2026): объекты — те же, что вкладка «Объекты» (/objects, а не снимок показателей на
// дату расчёта); договоры и корпоративные связи — те же контрагенты, что «С кем связана» и плитка «Связи»
// (/partners: положительное, состоявшееся или заявленное). Сообщения о договоре в виде плана, возможности или
// отрицания контрагентом не делают — они отдельной строкой «Не учтено как договор». Совместное участие и вопросы
// проверки — из резюме компании (dossier-summary).

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { IPartnerLink, IStatement } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import { ASSERTION_ROLE_LABELS, ATTRIBUTION_LABELS, REVIEW_QUEUE_KIND_LABELS } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { partnerLinkText } from '../CompanyPartners';
import { EvidenceButton } from '../EvidenceButton';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Heading } from '../ui/Heading';
import { ProjectContextButton } from './ProjectContextButton';
import { useCompanyObjects, useCompanyPartners, useCompanySummary } from './useCompanyQueries';
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

/** Контрагентов в «Участии и связях»: максимум сервера; сколько всего — counts ответа. */
const PARTNERS_MAX = 50;

const LinkRows: FC<{ rows: Array<{ key: string; name: string; companyId: number; link: IPartnerLink }> }> = ({ rows }) => (
  <ul className={styles.rows}>
    {rows.map(r => (
      <li key={r.key} className={styles.row}>
        <div className={styles.rowMain}>
          <p className={styles.rowTitle}>
            <Link to={`/company/${r.companyId}`} viewTransition>
              {r.name}
            </Link>{' '}
            — {partnerLinkText(r.link)}
            {r.link.projectName ? `, ${r.link.projectName}` : ''}
          </p>
        </div>
        <div className={styles.rowActions}>
          {r.link.assertionId !== null && <EvidenceButton assertionIds={[r.link.assertionId]} lead={`${r.name} — ${partnerLinkText(r.link)}`} />}
        </div>
      </li>
    ))}
  </ul>
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
  const summary = useCompanySummary(companyId);
  const objects = useCompanyObjects(companyId);
  const partners = useCompanyPartners(companyId, PARTNERS_MAX);

  if (summary.isLoading || objects.isLoading || partners.isLoading) {
    return <LoadingSkeleton label="Загружаю участие и связи…" lines={4} height="48px" />;
  }
  const failed = summary.isError ? summary : objects.isError ? objects : partners.isError ? partners : null;
  if (failed || !summary.data) {
    return (
      <Callout
        tone="danger"
        title="Участие и связи не загрузились"
        action={
          <Button size="sm" onClick={() => void (failed ?? summary).refetch()}>
            Повторить
          </Button>
        }
      >
        {describeLoadError((failed ?? summary).error)}
      </Callout>
    );
  }

  // Объекты с названной ролью — свои и застройщиков группы, как вкладка «Объекты».
  const participations = (objects.data?.items ?? []).filter(o => o.basis === 'participation' && o.roles.length > 0);
  const links = (partners.data?.items ?? []).flatMap(p => p.links.map((link, i) => ({ key: `${p.companyId}-${link.kind}-${link.assertionId ?? i}`, name: p.name, companyId: p.companyId, link })));
  const contracts = links.filter(l => l.link.kind === 'contract');
  const corporate = links.filter(l => l.link.kind === 'corporate');
  const counted = new Set(links.flatMap(l => (l.link.assertionId !== null ? [l.link.assertionId] : [])));
  // Сообщения о договоре, которые контрагентом не делают: план, возможность, отрицание (их нет в /partners).
  const notCounted = summary.data.counterparties.contracts.filter(s => !s.assertionIds.some(id => counted.has(id)));
  const { coParticipants } = summary.data.counterparties;
  const contradictions = summary.data.contradictions;
  const issues = Object.entries(
    contradictions.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.kind]: (acc[c.kind] ?? 0) + 1 }), {}),
  ).map(([kind, n]) => `${REVIEW_QUEUE_KIND_LABELS[kind] ?? 'вопрос проверки'} — ${formatCount(n)}`);
  const noLinks = contracts.length === 0 && corporate.length === 0 && coParticipants.length === 0;
  const linksTruncated = (partners.data?.counts?.companies ?? 0) > (partners.data?.items.length ?? 0);

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

      <Group title="Объекты" caption="участие по сообщениям источников и реестру — как на вкладке «Объекты»">
        {participations.length > 0 ? (
          <ul className={styles.rows}>
            {participations.map(o => {
              const roles = o.roles.map(r => `${ASSERTION_ROLE_LABELS[r.role] ?? 'роль не названа'}${r.isCurrent ? '' : ' (в прошлом)'}`).join(', ');
              const assertionIds = o.roles.flatMap(r => r.assertionIds ?? []);
              return (
                <li key={o.projectId} className={styles.row}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>
                      <Link to={`/projects/${o.projectId}`} viewTransition>
                        {o.name}
                      </Link>{' '}
                      — {roles}
                    </p>
                    {o.via && (
                      <p className={styles.rowMeta}>
                        <span>
                          через{' '}
                          <Link to={`/company/${o.via.companyId}`} viewTransition>
                            {o.via.name}
                          </Link>
                        </span>
                      </p>
                    )}
                  </div>
                  <div className={styles.rowActions}>
                    <EvidenceButton assertionIds={assertionIds} lead={`${o.name} — ${roles}`} />
                    {!o.via && <ProjectContextButton companyId={companyId} projectId={o.projectId} projectName={o.name} />}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState size="sm" icon={false}>
            Участие в объектах в собранных публикациях и реестре не найдено.
          </EmptyState>
        )}
      </Group>

      {contracts.length > 0 && (
        <Group title="Договоры" caption="по сообщениям источников — те же, что «С кем связана»">
          <LinkRows rows={contracts} />
        </Group>
      )}
      {corporate.length > 0 && (
        <Group title="Корпоративные связи" caption="по сообщениям источников и реестру">
          <LinkRows rows={corporate} />
        </Group>
      )}
      {linksTruncated && <p className={styles.note}>Показаны первые {formatCount(PARTNERS_MAX)} контрагентов; остальные — на схеме связей.</p>}
      {notCounted.length > 0 && (
        <Group title="Не учтено как договор" caption="план, возможность или отрицание — контрагентом это не делает">
          <StatementRows items={notCounted} />
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
