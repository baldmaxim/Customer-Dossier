// «Объекты»: участие компании и объекты, по которым есть её события.
//
// Одна компания бывает на объекте в нескольких ролях — строка на объект, роли ярлыками рядом,
// а не повтор объекта на каждую роль. Роль берётся только из card_participations_v;
// событие без участия оставляет роль неизвестной.

import { FC } from 'react';
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
  selectedProjectId: number | null;
  onSelect: (projectId: number) => void;
}

interface IProjectGroup {
  project: IProjectRow;
  roles: Array<{ role: string; isCurrent: boolean }>;
}

const roleText = (role: string): string => ASSERTION_ROLE_LABELS[role] ?? role;

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

export const CompanyProjects: FC<ICompanyProjectsProps> = ({ projects, isLoading, error, selectedProjectId, onSelect }) => {
  const groups = groupByProject(projects);

  return (
    <Section title="Объекты" note={groups.length > 0 ? `в выборке: ${groups.length}` : undefined}>
      {Boolean(error) && <p role="alert">{describeLoadError(error)}</p>}
      {isLoading && <p className={styles.muted}>Загрузка…</p>}
      {!isLoading && !error && groups.length === 0 && (
        <EmptyState>
          Объектов в выборке нет: компания не названа участником объекта и с ней не связано событий по объектам.
          Это не значит, что объектов у неё нет.
        </EmptyState>
      )}

      <ul className={styles.list}>
        {groups.map(({ project: p, roles }) => {
          return (
            <li key={p.id} className={`${styles.item} ${selectedProjectId === p.id ? styles.selected : ''}`}>
              <button type="button" className={styles.pick} aria-pressed={selectedProjectId === p.id}
                aria-controls="company-project-detail" onClick={() => onSelect(p.id)}>
                <span className={styles.head}>
                  <span className={styles.name}>{p.name}</span>
                  {p.city && <span className={styles.meta}>{p.city}</span>}
                </span>
                <span className={styles.tags}>
                  {roles.length === 0 && <Badge>{p.basis === 'event' ? 'из событий · роль не установлена' : 'роль не указана'}</Badge>}
                  {roles.map(r => <Badge key={r.role} tone="accent">{roleText(r.role)}{r.isCurrent ? '' : ' (в прошлом)'}</Badge>)}
                  <Badge>{STAGE_LABELS[p.stage] ?? p.stage}</Badge>
                  {p.plannedCompletion && <span className={styles.meta}>план {formatDate(p.plannedCompletion)}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
};
