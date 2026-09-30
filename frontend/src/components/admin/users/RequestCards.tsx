// Заявки на доступ карточками (уже 900px): кто и когда, роль после одобрения, решение внизу.

import { FC } from 'react';

import { formatDateTime } from '../../../lib/labels';
import { Button } from '../../ui/Button';
import { CardList } from '../../ui/CardList';
import { CardListItem } from '../../ui/CardListItem';
import { Cluster } from '../../ui/Cluster';
import { VisuallyHidden } from '../../ui/VisuallyHidden';
import type { IRequestsViewProps } from './RegistrationRequests';
import { RequestRoleSelect } from './RequestRoleSelect';
import { UserIdentity } from './UserIdentity';
import styles from './Users.module.css';

export const RequestCards: FC<IRequestsViewProps> = ({ requests, rejected, label, roleOf, onRole, actions }) => (
  <CardList label={label}>
    {requests.map(r => {
      const busy = actions.isDeciding(r);
      return (
        <CardListItem
          key={r.id}
          title={<UserIdentity user={r} self={false} />}
          meta={`подана ${formatDateTime(r.createdAt)}`}
          actions={
            <Cluster gap={2}>
              <Button variant="primary" loading={busy} onClick={() => actions.approve(r, roleOf(r))}>
                Одобрить<VisuallyHidden> «{r.displayName}»</VisuallyHidden>
              </Button>
              {!rejected && (
                <Button variant="danger" disabled={busy} onClick={() => void actions.reject(r)}>
                  Отклонить<VisuallyHidden> «{r.displayName}»</VisuallyHidden>
                </Button>
              )}
            </Cluster>
          }
        >
          <RequestRoleSelect
            request={r}
            value={roleOf(r)}
            onChange={role => onRole(r, role)}
            disabled={busy}
            className={styles.requestRoleCard}
          />
        </CardListItem>
      );
    })}
  </CardList>
);
