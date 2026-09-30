// «Объекты»: участие компании и объекты, по которым есть её события.
//
// Одна компания бывает на объекте в нескольких ролях — строка на объект, роли ярлыками рядом,
// а не повтор объекта на каждую роль. Роль берётся только из card_participations_v;
// событие без участия оставляет роль неизвестной. Строка — настоящая ссылка на страницу
// объекта (вся строка кликается): объект живёт только на своей странице.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IProjectRow } from '../api/types';
import { formatCount } from '../lib/format';
import { ASSERTION_ROLE_LABELS, STAGE_LABELS, formatDate } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { LoadingSkeleton } from './LoadingSkeleton';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { EmptyState } from './ui/EmptyState';
import { Section } from './ui/Section';
import styles from './CompanyProjects.module.css';

interface ICompanyProjectsProps {
  projects: IProjectRow[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
}

interface IProjectGroup {
  project: IProjectRow;
  roles: Array<{ role: string; isCurrent: boolean }>;
}

const groupByProject = (rows: IProjectRow[]): IProjectGroup[] => {
  const groups = new Map<number, IProjectGroup>();
  for (const row of rows) {
    const group = groups.get(row.id) ?? { project: row, roles: [] };
    if (row.role !== null) {
      const role = group.roles.find(r => r.role === row.role);
      if (role) role.isCurrent ||= Boolean(row.isCurrent);
      else group.roles.push({ role: row.role, isCurrent: Boolean(row.isCurrent) });
    }
    groups.set(row.id, group);
  }
  return [...groups.values()];
};

/** «Санкт-Петербург · строится · план 31.12.2027»: точка прилипает к слову слева и не начинает строку. */
const metaText = (p: IProjectRow): string =>
  [p.city, STAGE_LABELS[p.stage] ?? p.stage, p.plannedCompletion ? `план ${formatDate(p.plannedCompletion)}` : null]
    .filter(Boolean)
    .join('\u00a0· ');

export const CompanyProjects: FC<ICompanyProjectsProps> = ({ projects, isLoading, error, onRetry }) => {
  const groups = groupByProject(projects);

  return (
    <Section title="Объекты" note={groups.length > 0 ? formatCount(groups.length) : undefined}>
      {isLoading && (
        <LoadingSkeleton label="Загружаю объекты…" lines={3} height="56px" />
      )}
      {Boolean(error) && (
        <Callout
          tone="danger"
          title="Объекты не загрузились"
          action={
            onRetry && (
              <Button size="sm" onClick={onRetry}>
                Повторить
              </Button>
            )
          }
        >
          {describeLoadError(error)}
        </Callout>
      )}
      {!isLoading && !error && groups.length === 0 && (
        <EmptyState size="sm">
          В собранных публикациях компания не названа участником объекта. Это не значит, что объектов у неё нет.
        </EmptyState>
      )}

      {groups.length > 0 && (
        <ul className={styles.list}>
          {groups.map(({ project: p, roles }) => (
            <li key={p.id} className={`${styles.item} row-link`}>
              <Link className={`row-link-target ${styles.name}`} to={`/projects/${p.id}`} viewTransition>
                {p.name}
              </Link>
              <span className={styles.meta}>{metaText(p)}</span>
              <span className={styles.tags}>
                {roles.length === 0 && (
                  <Badge>{p.basis === 'event' ? 'упомянут в событиях, роль не названа' : 'роль не названа'}</Badge>
                )}
                {roles.map(r => (
                  <Badge key={r.role} tone="accent">
                    {ASSERTION_ROLE_LABELS[r.role] ?? r.role}
                    {r.isCurrent ? '' : ' (в прошлом)'}
                  </Badge>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};
