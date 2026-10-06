// Страницы длинного списка: «Назад · 51–100 из 4 700, страница 2 из 94 · Вперёд». Номер страницы
// живёт в адресе у вызывающего (`useUrlState('page', numberParam(1))`), считает сервер (offset).
// Всё помещается на одну страницу — ничего не рисуется.

import { FC } from 'react';

import { formatCount } from '../../lib/format';
import { Button } from './Button';
import styles from './Pagination.module.css';

export interface IPaginationProps {
  /** Имя навигации для диктора: «Страницы карточек ДОМ.РФ». */
  label: string;
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize));

export const Pagination: FC<IPaginationProps> = ({ label, page, pageSize, total, onChange }) => {
  const pages = pageCount(total, pageSize);
  if (pages <= 1 && page <= 1) return null;
  const from = Math.min(total, (page - 1) * pageSize + 1);
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label={label} className={styles.pagination}>
      <Button size="sm" icon="back" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Назад
      </Button>
      <span className={styles.status} aria-live="polite">
        {formatCount(from)}–{formatCount(to)} из {formatCount(total)}
        <span className={styles.page}>
          , страница {formatCount(page)} из {formatCount(pages)}
        </span>
      </span>
      <Button size="sm" iconEnd="forward" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Вперёд
      </Button>
    </nav>
  );
};
