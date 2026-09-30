// Многострочное поле: высота меняется только по вертикали, шрифт не меньше 16px.

import { FC, Ref, TextareaHTMLAttributes } from 'react';

import styles from './Input.module.css';

export interface ITextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export const Textarea: FC<ITextareaProps> = ({ invalid, rows = 4, className, ...rest }) => (
  <textarea
    {...rest}
    rows={rows}
    aria-invalid={invalid || rest['aria-invalid'] || undefined}
    className={[styles.control, styles.textarea, styles.block, className ?? ''].filter(Boolean).join(' ')}
  />
);
