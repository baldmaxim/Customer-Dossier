import { FC } from 'react';

import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Button } from '../components/ui/Button';
import styles from './LoginPage.module.css';

interface IPasswordChangePageProps {
  login: string;
  onChange: (currentPassword: string, newPassword: string) => Promise<void>;
  onLogout: () => void;
}

/**
 * Первый вход с паролем от администратора (или после сброса): до смены сервер не отдаёт
 * данных (`password_change_required`), поэтому портал не открывается вовсе.
 */
export const PasswordChangePage: FC<IPasswordChangePageProps> = ({ login, onChange, onLogout }) => (
  <main className={styles.shell}>
    <div className={styles.card}>
      <h1 className={styles.title}>Задайте свой пароль</h1>
      <p className={styles.hint}>
        Вы вошли как <strong>{login}</strong> с паролем, который выдал администратор. Чтобы продолжить, задайте свой — его
        будете знать только вы.
      </p>
      <ChangePasswordForm onSubmit={onChange} currentLabel="Пароль от администратора" submitLabel="Сохранить и войти" />
      <Button variant="ghost" onClick={onLogout}>
        Выйти
      </Button>
    </div>
  </main>
);
