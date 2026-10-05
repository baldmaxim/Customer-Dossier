// Вкладка «Объекты» (02.10.2026): объекты компании и застройщиков её группы карточками.
//
// Фильтры — роль и источник сведений — в адресе (?orole=, ?osrc=): «Назад» возвращает тот же вид.
// Роли в фильтре — только те, что есть в списке: пустой пункт меню хуже отсутствующего.
// Объекты группы помечены «через СЗ …» и отфильтровываются той же ролью, что у СЗ.

import { FC } from 'react';

import type { ICompanyObject } from '../../api/types';
import { stringParam, enumParam, useUrlState } from '../../hooks/useUrlState';
import { formatCount } from '../../lib/format';
import { ASSERTION_ROLE_LABELS } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Section } from '../ui/Section';
import { Segmented } from '../ui/Segmented';
import { ObjectCard } from './ObjectCard';
import { useCompanyObjects } from './useCompanyQueries';
import styles from './CompanyObjects.module.css';

const SOURCES = ['all', 'registry', 'publications'] as const;
type SourceFilter = (typeof SOURCES)[number];

const SOURCE_ITEMS: ReadonlyArray<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'registry', label: 'Есть в ДОМ.РФ' },
  { value: 'publications', label: 'Только публикации' },
];

/** Роли в порядке частоты: самая частая — первой после «Все». */
const rolesOf = (items: ICompanyObject[]): string[] => {
  const counts = new Map<string, number>();
  for (const o of items) for (const r of o.roles) counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([role]) => role);
};

export const CompanyObjects: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanyObjects(companyId);
  const [role, setRole] = useUrlState('orole', stringParam());
  const [source, setSource] = useUrlState('osrc', enumParam(SOURCES, 'all'));

  const items = query.data?.items ?? [];
  const roles = rolesOf(items);
  const shown = items.filter(
    o =>
      (!role || o.roles.some(r => r.role === role)) &&
      (source === 'all' || (source === 'registry') === (o.registry !== null)),
  );
  const coverage = query.data?.coverage;
  const members = query.data?.members ?? [];

  return (
    // Без своей карточки: объекты — сами карточки в рамках; рамка вокруг них была второй (05.10.2026).
    <Section
      variant="plain"
      title="Объекты"
      note={coverage ? (coverage.truncated ? `первые ${formatCount(coverage.loaded)} из ${formatCount(coverage.total)}` : formatCount(coverage.total)) : undefined}
    >
      {query.isLoading && <LoadingSkeleton label="Загружаю объекты…" lines={4} height="160px" radius="md" />}
      {query.isError && (
        <Callout
          tone="danger"
          title="Объекты не загрузились"
          action={
            <Button size="sm" onClick={() => void query.refetch()}>
              Повторить
            </Button>
          }
        >
          {describeLoadError(query.error)}
        </Callout>
      )}
      {query.isSuccess && items.length === 0 && (
        <EmptyState size="sm">
          Ни в публикациях, ни в ДОМ.РФ компания не названа участником объекта. Это не значит, что объектов у неё нет.
        </EmptyState>
      )}

      {items.length > 0 && (
        <div className={styles.body}>
          <div className={styles.filters}>
            {roles.length > 1 && (
              <Segmented
                label="Роль компании"
                items={[{ value: '', label: 'Все роли' }, ...roles.map(r => ({ value: r, label: ASSERTION_ROLE_LABELS[r] ?? r }))]}
                value={roles.includes(role) ? role : ''}
                onChange={setRole}
              />
            )}
            <Segmented label="Источник сведений" items={SOURCE_ITEMS} value={source} onChange={setSource} />
          </div>
          {members.length > 0 && (
            <p className={styles.note}>
              Вместе с объектами застройщиков группы: {members.map(m => m.name).join(', ')}. У таких объектов роль — у застройщика, а не у
              самой компании.
            </p>
          )}
          {shown.length === 0 ? (
            <EmptyState size="sm">Под выбранные условия объектов нет.</EmptyState>
          ) : (
            <ul className={styles.grid}>
              {shown.map(o => (
                <li key={o.projectId} className={styles.cell}>
                  <ObjectCard object={o} />
                </li>
              ))}
            </ul>
          )}
          <p className={styles.note}>
            Сведения ДОМ.РФ — то, что опубликовано на сайте на указанную дату: статус, сроки и цены указывает сам застройщик.
          </p>
        </div>
      )}
    </Section>
  );
};
