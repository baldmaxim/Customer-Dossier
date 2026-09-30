// Флажок с подписью: вся строка — цель нажатия не меньше 44px, а не квадратик 13px.
// Подсказка — под подписью, вне <label>: в имя флажка она не входит, только в описание.

import { FC, InputHTMLAttributes, ReactNode, useId } from 'react';

import styles from './Input.module.css';

export interface ICheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'size' | 'checked'> {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const Checkbox: FC<ICheckboxProps> = ({ label, hint, checked, onChange, className, id, ...rest }) => {
  const auto = useId();
  const hintId = hint ? `${id ?? auto}-hint` : undefined;
  return (
    <div className={[styles.checkWrap, rest.disabled ? styles.checkDisabled : '', className ?? ''].filter(Boolean).join(' ')}>
      <label className={styles.check}>
        <input
          {...rest}
          id={id}
          type="checkbox"
          className={styles.checkBox}
          checked={checked}
          aria-describedby={hintId}
          onChange={e => onChange(e.target.checked)}
        />
        <span className={styles.checkText}>{label}</span>
      </label>
      {hint && (
        <span id={hintId} className={styles.checkHint}>
          {hint}
        </span>
      )}
    </div>
  );
};
