import { FC } from 'react';

import type { IUserRow, UserRole } from '../../../api/types';
import { USER_ROLE_LABELS } from '../../../lib/labels';
import { Select } from '../../ui/Select';
import type { IUserActions } from './useUserActions';

const ROLES: UserRole[] = ['viewer', 'operator', 'admin'];

interface IUserRoleSelectProps {
  user: IUserRow;
  self: boolean;
  actions: IUserActions;
}

/**
 * Роль — выбором из списка, но меняется только после подтверждения. Значение списка — роль
 * с сервера: отказ в подтверждении возвращает прежнюю сам собой, без отката вручную.
 */
export const UserRoleSelect: FC<IUserRoleSelectProps> = ({ user, self, actions }) => (
  <Select
    aria-label={`Роль: ${user.displayName}`}
    value={user.role}
    block={false}
    disabled={self || actions.isUpdating(user)}
    onChange={e => void actions.changeRole(user, e.target.value as UserRole)}
  >
    {ROLES.map(r => (
      <option key={r} value={r}>
        {USER_ROLE_LABELS[r]}
      </option>
    ))}
  </Select>
);
