// Первый вход с паролем от администратора (или после сброса): до смены сервер не отдаёт
// данных (`password_change_required`), поэтому портал не открывается вовсе.

import { FC } from 'react';

import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Button } from '../components/ui/Button';
import { usePageTitle } from '../hooks/usePageTitle';
import { AuthCard } from './AuthCard';

interface IPasswordChangePageProps {
  login: string;
  onChange: (currentPassword: string, newPassword: string) => Promise<void>;
  onLogout: () => void;
}

export const PasswordChangePage: FC<IPasswordChangePageProps> = ({ login, onChange, onLogout }) => {
  usePageTitle('Смена пароля');
  return (
    <AuthCard
      title="Задайте свой пароль"
      lead={
        <>
          Вы вошли как <strong>{login}</strong> с паролем, который выдал администратор. Чтобы продолжить, задайте свой — его будете знать
          только вы.
        </>
      }
    >
      <ChangePasswordForm onSubmit={onChange} currentLabel="Пароль от администратора" submitLabel="Сохранить и войти" />
      <div>
        <Button variant="ghost" icon="exit" onClick={onLogout}>
          Выйти
        </Button>
      </div>
    </AuthCard>
  );
};
