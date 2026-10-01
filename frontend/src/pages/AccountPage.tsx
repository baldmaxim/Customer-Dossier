// Профиль — раздел админки (/admin/account): кто я, что мне можно, смена пароля, ключи доступа, выход.
// Заголовок «Профиль» даёт AdminLayout — и администратору, и читателю.

import { FC, useState } from 'react';

import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { PasskeysPanel } from '../components/passkeys/PasskeysPanel';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { DescriptionList } from '../components/ui/DescriptionList';
import { EmptyState } from '../components/ui/EmptyState';
import { Heading } from '../components/ui/Heading';
import { Section } from '../components/ui/Section';
import { Stack } from '../components/ui/Stack';
import { useAuth } from '../hooks/useAuth';
import { ACCESS_PERMISSION_LABELS, USER_ROLE_HINTS, USER_ROLE_LABELS, visiblePermissions } from '../lib/labels';
import styles from './AccountPage.module.css';

export const AccountPage: FC = () => {
  const { user, authRequired, logout, changePassword, passkeys } = useAuth();
  const [changed, setChanged] = useState(false);

  return (
    <Stack gap={5} className={styles.page}>
      <Section title={user.displayName}>
        <Stack gap={4}>
          <DescriptionList
            items={[
              { label: 'Логин', value: <span className={styles.mono}>{user.login}</span> },
              {
                label: 'Роль',
                value: (
                  <Stack gap={1}>
                    <span>
                      <Badge tone="accent">{USER_ROLE_LABELS[user.role]}</Badge>
                    </span>
                    <span className={styles.roleHint}>{USER_ROLE_HINTS[user.role]}</span>
                  </Stack>
                ),
              },
            ]}
          />
          <Stack gap={2}>
            <Heading className={styles.subtitle}>Что можно</Heading>
            <ul className={styles.permissions}>
              {visiblePermissions(user.permissions).map(p => (
                <li key={p}>{ACCESS_PERMISSION_LABELS[p]}</li>
              ))}
            </ul>
          </Stack>
        </Stack>
      </Section>

      <Section title="Пароль">
        {authRequired ? (
          <Stack gap={3}>
            {changed && (
              <Callout tone="success" live="polite" onClose={() => setChanged(false)}>
                Пароль сменён. Входы с других устройств закрыты — там понадобится войти заново.
              </Callout>
            )}
            <ChangePasswordForm onSubmit={changePassword} onDone={() => setChanged(true)} />
          </Stack>
        ) : (
          <EmptyState size="sm">Портал работает локально, без входа: пароль не нужен.</EmptyState>
        )}
      </Section>

      {/* Ключи — только на сервере с адресом-доменом: локально входа нет, по IP браузер ключ не создаст. */}
      {authRequired && passkeys && (
        <Section title="Ключи доступа">
          <PasskeysPanel />
        </Section>
      )}

      {logout && (
        <div>
          <Button variant="secondary" icon="exit" onClick={logout}>
            Выйти
          </Button>
        </div>
      )}
    </Stack>
  );
};
