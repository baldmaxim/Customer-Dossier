// Заявки на доступ таблицей (от 900px): кто, когда подал, роль после одобрения, решение.

import { FC } from 'react';

import { formatDateTime } from '../../../lib/labels';
import { Button } from '../../ui/Button';
import { Cluster } from '../../ui/Cluster';
import { TableScroll } from '../../ui/TableScroll';
import { VisuallyHidden } from '../../ui/VisuallyHidden';
import type { IRequestsViewProps } from './RegistrationRequests';
import { RequestRoleSelect } from './RequestRoleSelect';
import { UserIdentity } from './UserIdentity';
import styles from './Users.module.css';

export const RequestsTable: FC<IRequestsViewProps> = ({ requests, rejected, label, roleOf, onRole, actions }) => (
  <TableScroll label={label} minWidth={720}>
    <thead>
      <tr>
        <th>Кто</th>
        <th>Подана</th>
        <th>Роль после одобрения</th>
        <th>
          <VisuallyHidden>Действия</VisuallyHidden>
        </th>
      </tr>
    </thead>
    <tbody>
      {requests.map(r => {
        const busy = actions.isDeciding(r);
        return (
          <tr key={r.id}>
            <td>
              <UserIdentity user={r} self={false} />
            </td>
            <td className="nowrap">{formatDateTime(r.createdAt)}</td>
            <td className={styles.roleCell}>
              <RequestRoleSelect request={r} value={roleOf(r)} onChange={role => onRole(r, role)} disabled={busy} labelHidden />
            </td>
            <td>
              <Cluster gap={1}>
                <Button size="sm" variant="primary" loading={busy} onClick={() => actions.approve(r, roleOf(r))}>
                  Одобрить<VisuallyHidden> «{r.displayName}»</VisuallyHidden>
                </Button>
                {!rejected && (
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => void actions.reject(r)}>
                    Отклонить<VisuallyHidden> «{r.displayName}»</VisuallyHidden>
                  </Button>
                )}
              </Cluster>
            </td>
          </tr>
        );
      })}
    </tbody>
  </TableScroll>
);
