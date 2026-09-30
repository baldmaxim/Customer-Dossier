// Оболочка админки: ступени конвейера и место для ступени.
//
// Навигация здесь называется «Конвейер», а не «Навигация»: два одинаковых
// доступных имени в дереве сделали бы неоднозначным поиск навигации в e2e.

import { FC } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import type { AccessPermission } from '../../api/types';
import { EmptyState } from '../../components/ui/Section';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminLayout.module.css';

interface IStep {
  to: string;
  label: string;
  end: boolean;
  no: string;
  permission: AccessPermission;
}

const STEPS: IStep[] = [
  { to: '/admin', label: 'Конвейер', end: true, no: '', permission: 'admin.view' },
  { to: '/admin/collect', label: 'Сбор', end: false, no: '1', permission: 'admin.view' },
  { to: '/admin/process', label: 'Обработка', end: false, no: '2', permission: 'admin.view' },
  { to: '/admin/result', label: 'Результат', end: false, no: '3', permission: 'admin.view' },
  { to: '/admin/review', label: 'Проверка', end: false, no: '', permission: 'admin.view' },
  { to: '/admin/users', label: 'Пользователи', end: false, no: '', permission: 'users.manage' },
];

export const AdminLayout: FC = () => {
  const { can } = useAuth();

  // Ссылку «Админка» читатель не видит, но адрес можно набрать руками: сервер ответит 403
  // на каждый запрос, а экран скажет это один раз словами.
  if (!can('admin.view')) {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>Админка</h1>
        <EmptyState>Админка доступна оператору и администратору. Роль выдаёт администратор портала.</EmptyState>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>Админка</h1>
      <p className={styles.lead}>
        Портал сам собирает тексты из допущенных источников, разбирает их моделью и переносит результат
        в карточки. Ступени идут по порядку: что не прошло сбор, до разбора не дойдёт. Запускать обработку
        руками не нужно — здесь видно, как она идёт.
      </p>
      <nav className={styles.steps} aria-label="Конвейер">
        {STEPS.filter(step => can(step.permission)).map(step => (
          <NavLink
            key={step.to}
            to={step.to}
            end={step.end}
            className={({ isActive }) => (isActive ? `${styles.step} ${styles.stepActive}` : styles.step)}
          >
            {step.no && <span className={styles.stepNo}>{step.no}</span>}
            {step.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
};

export interface INoticeProps {
  text: string;
  onClose: () => void;
}

/** Сообщение о результате действия оператора. */
export const Notice: FC<INoticeProps> = ({ text, onClose }) => (
  <div className={styles.notice} role="status">
    <span className={styles.noticeText}>{text}</span>
    <button type="button" onClick={onClose} aria-label="Закрыть">
      ×
    </button>
  </div>
);
