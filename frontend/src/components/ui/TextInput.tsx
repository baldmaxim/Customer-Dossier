// Однострочное поле. Внешний вид — общий для полей портала (index.css + Input.module.css);
// шрифт не меньше 16px, иначе iOS и Android зумят форму при фокусе.

import { FC, InputHTMLAttributes, Ref } from 'react';

import styles from './Input.module.css';

export interface ITextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'md' | 'lg';
  /** Во всю ширину родителя (по умолчанию); false — по содержимому, для строки фильтров. */
  block?: boolean;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export const TextInput: FC<ITextInputProps> = ({ size = 'md', block = true, invalid, className, type = 'text', ...rest }) => (
  <input
    {...rest}
    type={type}
    aria-invalid={invalid || rest['aria-invalid'] || undefined}
    className={[styles.control, styles[size], block ? styles.block : '', className ?? ''].filter(Boolean).join(' ')}
  />
);
