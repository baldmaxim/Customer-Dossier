// Выданный пароль: крупно, моноширинно, с кнопкой «Скопировать». Показывается один раз —
// ни в адресе, ни в журнале, ни в хранилище браузера его нет.

import { FC, useState } from 'react';

import { Button } from '../../ui/Button';
import { Stack } from '../../ui/Stack';
import styles from './Users.module.css';

interface IIssuedPasswordProps {
  login: string;
  password: string;
}

export const IssuedPassword: FC<IIssuedPasswordProps> = ({ login, password }) => {
  const [copied, setCopied] = useState(false);
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined;

  return (
    <Stack gap={3}>
      <p className={styles.note}>
        Пароль для входа <strong>{login}</strong>:
      </p>
      <div className={styles.issued}>
        <code className={styles.password}>{password}</code>
        {canCopy && (
          <Button
            size="sm"
            icon={copied ? 'check' : undefined}
            onClick={() => {
              void navigator.clipboard.writeText(password).then(() => setCopied(true));
            }}
          >
            {copied ? 'Скопирован' : 'Скопировать'}
          </Button>
        )}
      </div>
      <p className={styles.note}>
        Передайте его пользователю: при входе он задаст свой. После закрытия окна пароль больше нигде не показывается.
      </p>
    </Stack>
  );
};
