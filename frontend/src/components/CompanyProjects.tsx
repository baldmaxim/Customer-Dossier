// «Объекты»: где компания названа участником и в какой роли.
//
// Одна компания бывает на объекте в нескольких ролях — строка на объект, роли ярлыками рядом,
// а не повтор объекта на каждую роль. Роль берётся только из положительного сообщения
// (card_participations_v): план и слух ролью не становятся. «Также на объекте» — соседи по
// объекту, а не контрагенты по договору.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IProjectRow } from '../api/types';
import { ASSERTION_ROLE_LABELS, STAGE_LABELS, formatDate } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { Badge } from './ui/Badge';
import { EmptyState, Section } from './ui/Section';
import styles from './CompanyProjects.module.css';

interface ICompanyProjectsProps {
  projects: IProjectRow[];
  isLoading: boolean;
  error: unknown;
}

interface IProjectGroup {
  project: IProjectRow;
  roles: Array<{ role: string; isCurrent: boolean }>;
}

const MAX_COUNTERPARTIES = 3;

const roleText = (role: string): string => ASSERTION_ROLE_LABELS[role] ?? role;

const groupByProject = (rows: IProjectRow[]): IProjectGroup[] => {
  const groups = new Map<number, IProjectGroup>();
  for (const row of rows) {
    const group = groups.get(row.id) ?? { project: row, roles: [] };
    if (!group.roles.some(r => r.role === row.role)) group.roles.push({ role: row.role, isCurrent: row.isCurrent });
    groups.set(row.id, group);
  }
  return [...groups.values()];
};

export const CompanyProjects: FC<ICompanyProjectsProps> = ({ projects, isLoading, error }) => {
  const groups = groupByProject(projects);

  return (
    <Section title="Объекты" note={groups.length > 0 ? `в выборке: ${groups.length}` : undefined}>
      {Boolean(error) && <p role="alert">{describeLoadError(error)}</p>}
      {isLoading && <p className={styles.muted}>Загрузка…</p>}
      {!isLoading && !error && groups.length === 0 && (
        <EmptyState>
          Объектов в выборке нет: ни в одной публикации компания не названа участником объекта. Это не значит,
          что объектов у неё нет.
        </EmptyState>
      )}

      <ul className={styles.list}>
        {groups.map(({ project: p, roles }) => {
          const others = p.counterparties ?? [];
          return (
            <li key={p.id} className={styles.item}>
              <div className={styles.head}>
                <Link className={styles.name} to={`/projects/${p.id}`}>
                  {p.name}
                </Link>
                {p.city && <span className={styles.meta}>{p.city}</span>}
              </div>
              <div className={styles.tags}>
                {roles.map(r => (
                  <Badge key={r.role} tone="accent">
                    {roleText(r.role)}
                    {r.isCurrent ? '' : ' (в прошлом)'}
                  </Badge>
                ))}
                <Badge>{STAGE_LABELS[p.stage] ?? p.stage}</Badge>
                {p.plannedCompletion && <span className={styles.meta}>план {formatDate(p.plannedCompletion)}</span>}
              </div>
              {others.length > 0 && (
                <p className={styles.others}>
                  Также на объекте:{' '}
                  {others.slice(0, MAX_COUNTERPARTIES).map((c, i) => (
                    <span key={`${c.id}-${c.role}`}>
                      {i > 0 && ', '}
                      <Link to={`/company/${c.id}`}>{c.name}</Link> ({roleText(c.role)})
                    </span>
                  ))}
                  {others.length > MAX_COUNTERPARTIES && ` и ещё ${others.length - MAX_COUNTERPARTIES}`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
};
