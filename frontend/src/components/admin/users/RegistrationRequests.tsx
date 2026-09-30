// Заявки на доступ (самостоятельная регистрация, ADR-014): кто просит доступ, когда подал и с
// какой ролью его пустить. Роль выбирается до решения — по умолчанию «читатель»; «Одобрить»
// открывает вход сразу, «Отклонить» — после подтверждения. Широко — таблицей, на телефоне —
// карточками. Отклонённые заявки — тем же списком, но без «Отклонить»: только передумать.

import { FC, useState } from 'react';

import type { IUserRow, UserRole } from '../../../api/types';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { MQ } from '../../../lib/media';
import { RequestCards } from './RequestCards';
import { RequestsTable } from './RequestsTable';
import { useRegistrationActions, type IRegistrationActions } from './useRegistrationActions';

export interface IRequestsViewProps {
  requests: IUserRow[];
  rejected: boolean;
  /** Имя списка для диктора. */
  label: string;
  roleOf: (request: IUserRow) => UserRole;
  onRole: (request: IUserRow, role: UserRole) => void;
  actions: IRegistrationActions;
}

interface IRegistrationRequestsProps {
  requests: IUserRow[];
  /** Отклонённые заявки: только «Одобрить». */
  rejected?: boolean;
}

export const RegistrationRequests: FC<IRegistrationRequestsProps> = ({ requests, rejected = false }) => {
  const wide = useMediaQuery(MQ.md);
  const actions = useRegistrationActions();
  const [roles, setRoles] = useState<Readonly<Record<number, UserRole>>>({});

  const view: IRequestsViewProps = {
    requests,
    rejected,
    label: rejected ? 'Отклонённые заявки' : 'Заявки на доступ',
    roleOf: request => roles[request.id] ?? 'viewer',
    onRole: (request, role) => setRoles(prev => ({ ...prev, [request.id]: role })),
    actions,
  };
  return wide ? <RequestsTable {...view} /> : <RequestCards {...view} />;
};
