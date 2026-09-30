// Профиль — вкладка админки (/admin/account): кто я, что мне можно, смена пароля, выход.
// Заголовок страницы даёт AdminLayout.

import { FC, useState } from 'react';

import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState, Section } from '../components/ui/Section';
import { useAuth } from '../hooks/useAuth';
import { ACCESS_PERMISSION_LABELS, USER_ROLE_HINTS, USER_ROLE_LABELS } from '../lib/labels';
import styles from './AccountPage.module.css';

export const AccountPage: FC = () => {
  const { user, authRequired, logout, changePassword } = useAuth();
  const [changed, setChanged] = useState(false);

  return (
    <div className={styles.page}>
      <Section title={user.displayName}>
        <dl className={styles.facts}>
          <dt>Логин</dt>
          <dd className={styles.mono}>{user.login}</dd>
          <dt>Роль</dt>
          <dd>
            <Badge tone="accent" hint={USER_ROLE_HINTS[user.role]}>
              {USER_ROLE_LABELS[user.role]}
            </Badge>
          </dd>
        </dl>
        <h3 className={styles.subtitle}>Что можно</h3>
        <ul className={styles.permissions}>
          {user.permissions.map(p => (
            <li key={p}>{ACCESS_PERMISSION_LABELS[p]}</li>
          ))}
        </ul>
      </Section>

      <Section title="Пароль">
        {authRequired ? (
          <>
            {changed && (
              <p className={styles.done} role="status">
                Пароль сменён. Входы с других устройств закрыты — там понадобится войти заново.
              </p>
            )}
            <ChangePasswordForm onSubmit={changePassword} onDone={() => setChanged(true)} />
          </>
        ) : (
          <EmptyState>Портал работает локально, без входа: пароль не нужен.</EmptyState>
        )}
      </Section>

      {logout && (
        <div>
          <Button variant="secondary" onClick={logout}>
            Выйти
          </Button>
        </div>
      )}
    </div>
  );
};
