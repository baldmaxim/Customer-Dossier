// Значение, которое копируют (ИНН, ОГРН): само значение и есть кнопка — цель нажатия шире
// значка, а значок рядом говорит, что будет. Результат — тостом.
//
// Без Clipboard API (старый движок, страница не по https) — просто текст: кнопка, которая
// ничего не делает, хуже её отсутствия.

import { FC } from 'react';

import { Icon } from './Icon';
import { useToast } from './toast';
import styles from './CopyValue.module.css';

export interface ICopyValueProps {
  value: string;
  /** Что копируется — для имени кнопки и тоста: «ИНН». */
  label: string;
  className?: string;
}

export const CopyValue: FC<ICopyValueProps> = ({ value, label, className }) => {
  const toast = useToast();
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
  if (!canCopy) return <span className={className}>{value}</span>;

  return (
    <button
      type="button"
      className={[styles.copy, className ?? ''].filter(Boolean).join(' ')}
      aria-label={`Скопировать ${label} ${value}`}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => toast.show({ id: 'copy-value', text: `${label} скопирован`, tone: 'success' }),
          () => toast.show({ id: 'copy-value', text: `Не удалось скопировать ${label}`, tone: 'danger' }),
        );
      }}
    >
      <span className={styles.value}>{value}</span>
      <Icon name="copy" size="sm" className={styles.icon} />
    </button>
  );
};
