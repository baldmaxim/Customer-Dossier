// Окно с паролем нового пользователя. Раньше пароль показывался баннером вверху страницы —
// на телефоне за краем экрана, и тем же баннером, что и любая другая новость.

import { FC, useState } from 'react';

import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { IssuedPassword } from './IssuedPassword';

export interface IIssuedPassword {
  login: string;
  password: string;
}

interface IIssuedPasswordDialogProps {
  issued: IIssuedPassword | null;
  onClose: () => void;
}

export const IssuedPasswordDialog: FC<IIssuedPasswordDialogProps> = ({ issued, onClose }) => {
  // Пока окно доигрывает выход, пароль остаётся на месте, а не пропадает раньше рамки.
  const [shown, setShown] = useState<IIssuedPassword | null>(issued);
  if (issued !== null && issued !== shown) setShown(issued);

  return (
    <Dialog
      open={issued !== null}
      onClose={onClose}
      title="Пользователь создан"
      // Случайный щелчок мимо окна не должен унести пароль, который больше нигде не увидеть.
      closeOnBackdrop={false}
      footer={
        <Button variant="primary" onClick={onClose}>
          Готово
        </Button>
      }
    >
      {shown && <IssuedPassword login={shown.login} password={shown.password} />}
    </Dialog>
  );
};
