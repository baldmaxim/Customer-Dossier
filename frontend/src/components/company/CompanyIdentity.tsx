// «Опознание» (вкладка «Подробно»): та ли это компания и всё ли о ней собрано в одну карточку.
// Реквизиты, варианты написания, похожие карточки, связи из реестра и открытые вопросы
// проверки. Ссылка в «Проверку» — только тем, кому админка доступна: читателя она уводила
// бы в «Профиль».

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { ICompanyResponse } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import { IDENTIFIER_TYPE_LABELS, IDENTITY_STATUS_LABELS, RELATION_LABELS, REVIEW_QUEUE_KIND_LABELS, formatDateTime } from '../../lib/labels';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { DescriptionList, type IDescriptionItem } from '../ui/DescriptionList';
import { Stack } from '../ui/Stack';
import { useCompanySignals, useCompanySimilar, useCompanySummary } from './useCompanyQueries';
import styles from './Company.module.css';

/** Ссылки столбиком: по одной компании или объекту в строке, каждая — цель нажатия на телефоне. */
const refList = (nodes: ReactNode[]): ReactNode => (
  <ul className={styles.refList}>
    {nodes.map((node, i) => (
      <li key={i}>{node}</li>
    ))}
  </ul>
);

export const CompanyIdentity: FC<{ companyId: number; data: ICompanyResponse }> = ({ companyId, data }) => {
  const canReview = useCan('admin.view');
  const signals = useCompanySignals(companyId);
  const summary = useCompanySummary(companyId);
  const similar = useCompanySimilar(companyId).data?.items ?? [];

  const identity = signals.data?.signals?.identity ?? null;
  const review = summary.data;
  const contradictions = review?.contradictions ?? [];
  const merges = identity?.pendingMerges ?? 0;
  const ambiguities = identity?.openAmbiguities ?? 0;
  const issues = merges + ambiguities + contradictions.length;

  const identifiers = data.identifiers ?? [];
  const aliases = data.aliases.map(a => a.alias).filter(alias => alias !== data.company.name);
  const relations = data.relations ?? [];
  const registryProjects = data.registryProjects ?? [];

  const items: IDescriptionItem[] = [
    {
      label: 'Реквизиты',
      value:
        identifiers.length > 0
          ? identifiers.map(i => `${IDENTIFIER_TYPE_LABELS[i.type] ?? 'реквизит'} ${i.value}`).join(', ')
          : 'не установлены',
    },
  ];
  if (aliases.length > 0) items.push({ label: 'Варианты написания', value: aliases.join(' · ') });
  if (similar.length > 0) {
    items.push({
      label: 'Похожие компании',
      value: refList(
        similar.map(s => (
          <Link className={styles.refLink} to={`/company/${s.id}`} viewTransition>
            {s.name}
          </Link>
        )),
      ),
    });
  }
  if (relations.length > 0) {
    items.push({
      label: 'Связи из реестра',
      value: refList(
        relations.map(r => (
          <>
            {RELATION_LABELS[r.relationType]?.[r.direction] ?? 'связана с'}{' '}
            <Link className={styles.refLink} to={`/company/${r.otherCompanyId}`} viewTransition>
              «{r.otherCompanyName}»
            </Link>
            {r.status === 'candidate' ? ' (не подтверждено)' : ''}
          </>
        )),
      ),
    });
  }
  if (registryProjects.length > 0) {
    items.push({
      label: 'Объекты в реестре',
      value: refList(
        registryProjects.map(p => (
          <Link className={styles.refLink} to={`/projects/${p.projectId}`} viewTransition>
            {p.name}
          </Link>
        )),
      ),
    });
  }
  if (identity) {
    items.push({
      label: 'Собрано',
      value: `источников — ${formatCount(identity.coverage.sources)}, публикаций — ${formatCount(identity.coverage.publications.value)}`,
    });
  }

  return (
    <Stack gap={3}>
      <p className={styles.identityLead}>
        {identity
          ? (IDENTITY_STATUS_LABELS[identity.status] ?? 'опознание не описано')
          : signals.isLoading
            ? 'Сверяю реквизиты…'
            : 'Реквизиты ещё не сверены: показатели не посчитаны.'}
      </p>
      <DescriptionList items={items} />

      {issues > 0 && (
        <Callout
          tone="warning"
          title="Нужна проверка"
          action={
            canReview && (
              <ButtonLink to="/admin/review" size="sm">
                Открыть «Проверку»
              </ButtonLink>
            )
          }
        >
          Возможных дублей — {formatCount(merges)}, неясных упоминаний — {formatCount(ambiguities)}, противоречий —{' '}
          {formatCount(contradictions.length)}.
          {contradictions.length > 0 && (
            <ul className={styles.issues}>
              {contradictions.slice(0, 3).map(item => (
                <li key={`${item.kind}-${item.assertionId}`}>{REVIEW_QUEUE_KIND_LABELS[item.kind] ?? 'вопрос проверки'}</li>
              ))}
            </ul>
          )}
        </Callout>
      )}
      {issues === 0 && identity && review && <p className={styles.muted}>Открытых вопросов по опознанию нет.</p>}
      {(signals.isError || summary.isError) && (
        <p className={styles.muted}>Часть сведений о проверке сейчас недоступна.</p>
      )}
      {review && (
        <p className={styles.note}>
          Обновлено {formatDateTime(review.generatedAt)}
          {review.signalsCutoff ? `; показатели посчитаны ${formatDateTime(review.signalsCutoff)}` : ''}
          {review.stale ? ' — расчёт устарел' : ''}.
        </p>
      )}
    </Stack>
  );
};
