// Окно «Открытые входы» пользователя (кнопка «Входы» в списке пользователей).

import { FC, useState } from 'react';

import type { IUserRow } from '../../../api/types';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { UserSessionList } from './UserSessionList';

interface IUserSessionsDialogProps {
  user: IUserRow | null;
  onClose: () => void;
}

export const UserSessionsDialog: FC<IUserSessionsDialogProps> = ({ user, onClose }) => {
  const [shown, setShown] = useState<IUserRow | null>(user);
  if (user !== null && user !== shown) setShown(user);

  return (
    <Dialog
      open={user !== null}
      onClose={onClose}
      title={shown ? `Открытые входы: ${shown.displayName}` : 'Открытые входы'}
      footer={
        <Button variant="primary" onClick={onClose}>
          Готово
        </Button>
      }
    >
      {shown && <UserSessionList user={shown} />}
    </Dialog>
  );
};
