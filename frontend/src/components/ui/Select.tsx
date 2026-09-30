// Выпадающий список: нативный <select> (на телефоне — системный барабан) со своим
// шевроном вместо системной стрелки, которая в тёмной теме терялась.

import { FC, Ref, SelectHTMLAttributes } from 'react';

import { Icon } from './Icon';
import styles from './Input.module.css';

export interface ISelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'md' | 'lg';
  /** Во всю ширину родителя (по умолчанию); false — по содержимому, для строки фильтров. */
  block?: boolean;
  invalid?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

export const Select: FC<ISelectProps> = ({ size = 'md', block = true, invalid, className, children, ...rest }) => (
  <span className={[styles.selectWrap, block ? styles.block : ''].filter(Boolean).join(' ')}>
    <select
      {...rest}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      className={[styles.control, styles.select, styles[size], block ? styles.block : '', className ?? ''].filter(Boolean).join(' ')}
    >
      {children}
    </select>
    <Icon name="chevron" size="sm" className={styles.selectIcon} />
  </span>
);
