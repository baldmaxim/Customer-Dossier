// Роли и права. Роли заданы в коде сервера (auth/permissions.ts); отсюда видно, что именно
// получит пользователь с той или иной ролью. Права снятых разделов (обращения и снимки)
// сервер ещё выдаёт, но экран их не показывает — раздела нет.
//
// На телефоне — по карточке на роль: матрица из четырёх колонок на 360px не помещалась.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IRolesInfo } from '../../../api/types';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { ACCESS_PERMISSION_LABELS, USER_ROLE_HINTS, USER_ROLE_LABELS, visiblePermissions } from '../../../lib/labels';
import { describeLoadError } from '../../../lib/loadError';
import { MQ } from '../../../lib/media';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { CardList } from '../../ui/CardList';
import { CardListItem } from '../../ui/CardListItem';
import { Icon } from '../../ui/Icon';
import { Loading } from '../../ui/Loading';
import { TableScroll } from '../../ui/TableScroll';
import { VisuallyHidden } from '../../ui/VisuallyHidden';
import styles from './Users.module.css';

export const RoleMatrix: FC = () => {
  const wide = useMediaQuery(MQ.sm);
  const rolesQuery = useQuery({
    queryKey: ['users', 'roles'],
    queryFn: () => api.get<IRolesInfo>('/api/users/roles'),
    staleTime: Infinity,
  });

  if (rolesQuery.isLoading) return <Loading label="Загружаю роли…" />;
  if (rolesQuery.isError || !rolesQuery.data) {
    return (
      <Callout tone="danger" title="Роли не загрузились" action={<Button onClick={() => void rolesQuery.refetch()}>Повторить</Button>}>
        {describeLoadError(rolesQuery.error)}
      </Callout>
    );
  }
  const { roles } = rolesQuery.data;
  const permissions = visiblePermissions(rolesQuery.data.permissions);

  if (!wide) {
    return (
      <CardList label="Роли и права">
        {roles.map(r => (
          <CardListItem key={r.role} title={USER_ROLE_LABELS[r.role]} meta={USER_ROLE_HINTS[r.role]}>
            <ul className={styles.permissions}>
              {visiblePermissions(r.permissions).map(p => (
                <li key={p}>{ACCESS_PERMISSION_LABELS[p]}</li>
              ))}
            </ul>
          </CardListItem>
        ))}
      </CardList>
    );
  }

  return (
    <TableScroll label="Роли и права" minWidth={560}>
      <thead>
        <tr>
          <th>Право</th>
          {roles.map(r => (
            <th key={r.role} className={styles.matrixRole}>
              {USER_ROLE_LABELS[r.role]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {permissions.map(p => (
          <tr key={p}>
            <td>{ACCESS_PERMISSION_LABELS[p]}</td>
            {roles.map(r => {
              const has = r.permissions.includes(p);
              return (
                <td key={r.role} className={styles.matrixCell}>
                  {has ? <Icon name="check" size="sm" className={styles.yes} /> : <span aria-hidden="true">—</span>}
                  <VisuallyHidden>{has ? 'есть' : 'нет'}</VisuallyHidden>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};
