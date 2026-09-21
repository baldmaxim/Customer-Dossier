// Единственная кнопка портала. До неё `.button` был определён заново в четырёх
// файлах, `.primary`/`.secondary` — в четырёх, `.linkButton` — в четырёх, и
// высота кнопки принимала семь разных значений.
//
// Подпись приходит как children и не меняется: тесты ищут кнопки по доступному
// имени. Иконка внутри обязана иметь aria-hidden, иначе имя изменится.

import { ButtonHTMLAttributes, FC } from 'react';

import { useHint } from './useHint';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface IButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Пояснение по наведению, фокусу и тапу. */
  hint?: string;
  /** Квадратная кнопка под одну иконку: тап-цель остаётся полной. */
  iconOnly?: boolean;
  /** Во всю ширину контейнера — формы на телефоне. */
  block?: boolean;
}

export const Button: FC<IButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  hint,
  iconOnly = false,
  block = false,
  type = 'button',
  className,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...rest
}) => {
  const { triggerProps, bubble } = useHint(hint);
  const cls = [
    styles.button,
    styles[variant],
    styles[size],
    iconOnly ? styles.iconOnly : '',
    block ? styles.block : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <button
        {...rest}
        ref={triggerProps.ref}
        aria-describedby={triggerProps['aria-describedby'] ?? rest['aria-describedby']}
        type={type}
        className={cls}
        onMouseEnter={e => {
          onMouseEnter?.(e);
          triggerProps.onMouseEnter();
        }}
        onMouseLeave={e => {
          onMouseLeave?.(e);
          triggerProps.onMouseLeave();
        }}
        onFocus={e => {
          onFocus?.(e);
          triggerProps.onFocus();
        }}
        onBlur={e => {
          onBlur?.(e);
          triggerProps.onBlur();
        }}
      />
      {bubble}
    </>
  );
};
