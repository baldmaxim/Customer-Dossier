// «Коротко о компании»: три плитки (объектов · публикаций · последняя публикация) и строка ролей.
//
// Здесь нет ни одного нового числа: всё берётся из расчёта показателей и уже загруженных
// объектов. Итоговой оценки, балла и светофора нет и не будет (ADR-009) — сводка отвечает
// «что известно», а не «хорошая ли это компания».
//
// Показатели могут быть не посчитаны, устареть или не загрузиться. Тогда сводка говорит это
// словами и показывает то, что видно без них, а не подставляет ноль вместо неизвестного.

import { FC } from 'react';

import type { IProjectRow, Role } from '../api/types';
import { formatCount } from '../lib/format';
import { ASSERTION_ROLE_LABELS, ROLE_LABELS, formatDate, formatDateTime } from '../lib/labels';
import { useCompanySignals } from './company/useCompanyQueries';
import { Button } from './ui/Button';
import { DescriptionList, type IDescriptionItem } from './ui/DescriptionList';
import { Section } from './ui/Section';
import styles from './CompanyBrief.module.css';

interface ICompanyBriefProps {
  companyId: number;
  projects: IProjectRow[];
  /** Список объектов пришёл: до этого «—», а не «0». */
  projectsKnown: boolean;
}

/** Роли по объектам карточки: запасной путь, когда показатели не посчитаны. */
const rolesFromProjects = (projects: IProjectRow[]): string => {
  const counts = new Map<Role, number>();
  const seen = new Set<string>();
  for (const p of projects) {
    if (p.role === null) continue;
    const key = `${p.id}:${p.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(p.role, (counts.get(p.role) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, n]) => `${ROLE_LABELS[role] ?? ASSERTION_ROLE_LABELS[role] ?? role} — ${n}`)
    .join(', ');
};

export const CompanyBrief: FC<ICompanyBriefProps> = ({ companyId, projects, projectsKnown }) => {
  const query = useCompanySignals(companyId);
  const signals = query.data?.signals ?? null;
  const refresh = query.data?.refresh;

  const rolesText = signals
    ? Object.entries(signals.experience.byRole)
        .filter(([, agg]) => (agg.value ?? 0) > 0)
        .sort((a, b) => (b[1].value ?? 0) - (a[1].value ?? 0))
        .map(([role, agg]) => `${ASSERTION_ROLE_LABELS[role] ?? role} — ${agg.value}`)
        .join(', ')
    : rolesFromProjects(projects);
  const cities = [...new Set(projects.map(p => p.city).filter((c): c is string => Boolean(c)))];

  const publications = signals?.media.publications;
  const latest = signals?.media.latestPublishedAt;
  const projectCount = new Set(projects.map(p => p.id)).size;

  const lines: IDescriptionItem[] = [{ label: 'Роли в публикациях', value: rolesText || 'роль не названа ни в одной публикации' }];
  if (cities.length > 0) lines.push({ label: 'География объектов', value: cities.slice(0, 4).join(', ') });

  return (
    <Section title="Коротко о компании">
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>объектов</dt>
          <dd className={styles.statValue}>{projectsKnown ? formatCount(projectCount) : '—'}</dd>
        </div>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>публикаций</dt>
          <dd className={styles.statValue}>{publications?.status === 'ok' ? formatCount(publications.value) : '—'}</dd>
        </div>
        <div className={`${styles.stat} ${styles.statWide}`}>
          <dt className={styles.statLabel}>последняя публикация</dt>
          <dd className={styles.statValue}>{latest?.value ? formatDate(latest.value) : '—'}</dd>
        </div>
      </dl>

      <DescriptionList items={lines} />

      <p className={styles.note}>
        {query.isError ? (
          <>
            Показатели не загрузились — числа публикаций не показаны.{' '}
            <Button variant="link" size="sm" onClick={() => void query.refetch()}>
              Повторить
            </Button>{' '}
          </>
        ) : refresh?.active ? (
          `Публикации и роли посчитаны ${formatDateTime(refresh.active.cutoffAt)}${refresh.stale ? ' — расчёт устарел' : ''}; объекты — на сегодня. `
        ) : query.isSuccess ? (
          'Показатели ещё не посчитаны: объекты — на сегодня, публикаций пока не видно. '
        ) : null}
        Это сведения из открытых публикаций, а не проверка контрагента и не оценка надёжности.
      </p>
    </Section>
  );
};
