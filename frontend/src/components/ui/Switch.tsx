// Переключатель «включено / выключено». Роль switch + aria-checked: диктор говорит
// «переключатель, включено», а не «кнопка, нажата». Подпись состояния — словом рядом,
// а не только цветом дорожки: цвет один нечитаем при дальтонизме.

import { FC } from 'react';

import styles from './Switch.module.css';

export interface ISwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Доступное имя: что включается («Сбор канала …»). */
  label: string;
  disabled?: boolean;
  /** Слова состояния рядом с дорожкой. */
  onText?: string;
  offText?: string;
}

export const Switch: FC<ISwitchProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  onText = 'включён',
  offText = 'выключен',
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className={`${styles.switch} ${checked ? styles.on : ''}`}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.track} aria-hidden="true">
      <span className={styles.thumb} />
    </span>
    <span className={styles.text}>{checked ? onText : offText}</span>
  </button>
);
