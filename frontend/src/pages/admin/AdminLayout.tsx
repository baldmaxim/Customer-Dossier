// Оболочка админки: ступени конвейера, модель, пользователи и свой профиль — одно место.
//
// Профиль — вкладка админки, а не отдельная страница в шапке. Читателю админка недоступна,
// и у него здесь одна вкладка — профиль: сменить пароль нужно и ему.
//
// Навигация здесь называется «Конвейер», а не «Навигация»: два одинаковых
// доступных имени в дереве сделали бы неоднозначным поиск навигации в e2e.

import { FC } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';

import type { AccessPermission } from '../../api/types';
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
  { to: '/admin/model', label: 'Модель', end: false, no: '', permission: 'admin.view' },
  { to: '/admin/users', label: 'Пользователи', end: false, no: '', permission: 'users.manage' },
  { to: '/admin/account', label: 'Профиль', end: false, no: '', permission: 'portal.read' },
];

const PROFILE_PATH = '/admin/account';

/** Пояснение про конвейер — только на его ступенях: над профилем и пользователями оно ни к чему. */
const NOT_PIPELINE = /^\/admin\/(model|users|account)(\/|$)/;

export const AdminLayout: FC = () => {
  const { can } = useAuth();
  const { pathname } = useLocation();

  // Ссылку «Админка» читатель не видит, но адрес можно набрать руками: сервер ответил бы 403
  // на каждый запрос. Ему здесь доступен только свой профиль.
  if (!can('admin.view')) {
    if (!pathname.startsWith(PROFILE_PATH)) return <Navigate to={PROFILE_PATH} replace />;
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>Профиль</h1>
        <Outlet />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>Админка</h1>
      {!NOT_PIPELINE.test(pathname) && (
        <p className={styles.lead}>
          Портал сам собирает тексты из допущенных источников, разбирает их моделью и переносит результат
          в карточки. Ступени идут по порядку: что не прошло сбор, до разбора не дойдёт. Запускать обработку
          руками не нужно — здесь видно, как она идёт.
        </p>
      )}
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
