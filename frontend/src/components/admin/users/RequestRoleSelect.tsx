import { FC } from 'react';

import type { IUserRow, UserRole } from '../../../api/types';
import { USER_ROLE_LABELS } from '../../../lib/labels';
import { Field } from '../../ui/Field';
import { Select } from '../../ui/Select';
import { VisuallyHidden } from '../../ui/VisuallyHidden';
import styles from './Users.module.css';

const ROLES: UserRole[] = ['viewer', 'operator', 'admin'];

interface IRequestRoleSelectProps {
  request: IUserRow;
  value: UserRole;
  onChange: (role: UserRole) => void;
  disabled: boolean;
  /** В таблице подпись даёт заголовок колонки: метка — только для диктора. */
  labelHidden?: boolean;
  className?: string;
}

/** С какой ролью пустить по заявке. Выбор ничего не отправляет — решает кнопка «Одобрить». */
export const RequestRoleSelect: FC<IRequestRoleSelectProps> = ({ request, value, onChange, disabled, labelHidden = false, className }) => (
  <Field
    className={[styles.requestRole, className ?? ''].filter(Boolean).join(' ')}
    labelHidden={labelHidden}
    label={
      <>
        Роль после одобрения<VisuallyHidden>: {request.displayName}</VisuallyHidden>
      </>
    }
  >
    {control => (
      <Select {...control} block={false} value={value} disabled={disabled} onChange={e => onChange(e.target.value as UserRole)}>
        {ROLES.map(r => (
          <option key={r} value={r}>
            {USER_ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
    )}
  </Field>
);
