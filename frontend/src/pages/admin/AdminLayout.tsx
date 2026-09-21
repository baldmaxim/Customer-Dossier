// Оболочка админки: ступени конвейера и место для ступени.
//
// Навигация здесь называется «Конвейер», а не «Навигация»: два одинаковых
// доступных имени в дереве сделали бы неоднозначным поиск навигации в e2e.

import { FC } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import styles from './AdminLayout.module.css';

interface IStep {
  to: string;
  label: string;
  end: boolean;
  no: string;
}

const STEPS: IStep[] = [
  { to: '/admin', label: 'Конвейер', end: true, no: '' },
  { to: '/admin/collect', label: 'Сбор', end: false, no: '1' },
  { to: '/admin/process', label: 'Обработка', end: false, no: '2' },
  { to: '/admin/result', label: 'Результат', end: false, no: '3' },
  { to: '/admin/review', label: 'Проверка', end: false, no: '' },
];

export const AdminLayout: FC = () => (
  <div className={styles.wrap}>
    <h1 className={styles.title}>Админка</h1>
    <p className={styles.lead}>
      Портал собирает тексты из допущенных источников, разбирает их моделью и публикует результат в карточки.
      Ступени идут по порядку: что не прошло сбор, до разбора не дойдёт.
    </p>
    <nav className={styles.steps} aria-label="Конвейер">
      {STEPS.map(step => (
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
