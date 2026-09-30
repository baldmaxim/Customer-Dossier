// Роли и права — таблицей. Роли заданы в коде сервера (auth/permissions.ts); отсюда видно,
// что именно получит пользователь с той или иной ролью.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IRolesInfo } from '../../../api/types';
import { ACCESS_PERMISSION_LABELS, USER_ROLE_LABELS } from '../../../lib/labels';
import { describeLoadError } from '../../../lib/loadError';
import { TableScroll } from '../../ui/TableScroll';
import styles from './Users.module.css';

export const RoleMatrix: FC = () => {
  const rolesQuery = useQuery({
    queryKey: ['users', 'roles'],
    queryFn: () => api.get<IRolesInfo>('/api/users/roles'),
    staleTime: Infinity,
  });

  if (rolesQuery.isError) return <p role="alert">{describeLoadError(rolesQuery.error)}</p>;
  const info = rolesQuery.data;
  if (!info) return null;

  return (
    <TableScroll minWidth={560}>
      <thead>
        <tr>
          <th>Право</th>
          {info.roles.map(r => (
            <th key={r.role} className={styles.matrixRole}>
              {USER_ROLE_LABELS[r.role]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {info.permissions.map(p => (
          <tr key={p}>
            <td>{ACCESS_PERMISSION_LABELS[p]}</td>
            {info.roles.map(r => {
              const has = r.permissions.includes(p);
              return (
                <td key={r.role} className={styles.matrixCell}>
                  <span aria-hidden="true">{has ? '✓' : '—'}</span>
                  <span className="visually-hidden">{has ? 'есть' : 'нет'}</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};
