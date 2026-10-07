// Однострочное поле. Внешний вид — общий для полей портала (index.css + Input.module.css);
// шрифт не меньше 16px, иначе iOS и Android зумят форму при фокусе.
// С onClear — крестик «Очистить» справа, пока в поле что-то написано; после очистки фокус остаётся в поле.

import { FC, InputHTMLAttributes, Ref, useRef } from 'react';

import { Icon } from './Icon';
import styles from './Input.module.css';
import { mergeRefs } from './mergeRefs';

export interface ITextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'md' | 'lg';
  /** Во всю ширину родителя (по умолчанию); false — по содержимому, для строки фильтров. */
  block?: boolean;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
  /** Очистить поле; задано — у непустого поля крестик. */
  onClear?: () => void;
  /** Доступное имя крестика. */
  clearLabel?: string;
}

export const TextInput: FC<ITextInputProps> = ({
  size = 'md',
  block = true,
  invalid,
  className,
  type = 'text',
  ref,
  onClear,
  clearLabel = 'Очистить поле',
  ...rest
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <input
      {...rest}
      ref={mergeRefs(ref, inputRef)}
      type={type}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      className={[styles.control, styles[size], block ? styles.block : '', onClear ? styles.clearable : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    />
  );
  if (!onClear) return input;

  const filled = rest.value !== undefined && String(rest.value) !== '';
  return (
    <div className={[styles.clearBox, block ? styles.block : ''].filter(Boolean).join(' ')}>
      {input}
      {filled && !rest.disabled && !rest.readOnly && (
        <button
          type="button"
          className={styles.clear}
          onClick={() => {
            onClear();
            inputRef.current?.focus();
          }}
          aria-label={clearLabel}
        >
          <Icon name="close" size="sm" />
        </button>
      )}
    </div>
  );
};
