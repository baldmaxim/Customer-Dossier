// Единственная кнопка портала. До неё `.button` был определён заново в четырёх
// файлах, `.primary`/`.secondary` — в четырёх, `.linkButton` — в четырёх, и
// высота кнопки принимала семь разных значений.
//
// Подпись приходит как children и не меняется: тесты ищут кнопки по доступному
// имени. Иконки (icon/iconEnd, спиннер) — aria-hidden и в имя не попадают.

import { ButtonHTMLAttributes, FC, MouseEvent, Ref, useMemo } from 'react';

import { Icon, type IconName } from './Icon';
import { mergeRefs } from './mergeRefs';
import { useHint } from './useHint';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface IButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Квадратная кнопка под одну иконку: тап-цель остаётся полной. Имя — через aria-label. */
  iconOnly?: boolean;
  /** Во всю ширину контейнера — формы и листы на телефоне. */
  block?: boolean;
  className?: string;
}

/** Классы кнопки для любого элемента: ButtonLink, внешняя ссылка <a>, <summary>. */
export const buttonClass = ({ variant = 'secondary', size = 'md', iconOnly = false, block = false, className }: IButtonLook = {}): string =>
  [styles.button, styles[variant], styles[size], iconOnly ? styles.iconOnly : '', block ? styles.block : '', className ?? '']
    .filter(Boolean)
    .join(' ');

export interface IButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, IButtonLook {
  /** Пояснение по наведению, фокусу и тапу. */
  hint?: string;
  /** Иконка перед подписью. */
  icon?: IconName;
  /** Иконка после подписи: «Открыть →» — forward, «Ещё ▾» — chevron. */
  iconEnd?: IconName;
  /**
   * Действие выполняется: спиннер, aria-busy, повторные нажатия игнорируются. Кнопка
   * остаётся в фокусе (aria-disabled, а не disabled): иначе фокус с клавиатуры падал на body.
   */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export const Button: FC<IButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  hint,
  iconOnly = false,
  block = false,
  icon,
  iconEnd,
  loading = false,
  ref,
  type = 'button',
  className,
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...rest
}) => {
  const { triggerProps, bubble } = useHint(hint);
  const hintRef = triggerProps.ref;
  const buttonRef = useMemo(() => mergeRefs(ref, hintRef), [ref, hintRef]);
  const iconSize = size === 'lg' ? 'md' : 'sm';
  const lead = loading ? 'spinner' : icon;

  return (
    <>
      <button
        {...rest}
        ref={buttonRef}
        aria-describedby={triggerProps['aria-describedby'] ?? rest['aria-describedby']}
        aria-description={triggerProps['aria-description'] ?? rest['aria-description']}
        aria-busy={loading || undefined}
        aria-disabled={loading || rest['aria-disabled'] || undefined}
        type={type}
        className={buttonClass({ variant, size, iconOnly, block, className })}
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          if (loading) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
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
      >
        {lead && <Icon name={lead} size={iconSize} className={loading ? styles.spinner : undefined} />}
        {children}
        {iconEnd && !loading && <Icon name={iconEnd} size={iconSize} />}
      </button>
      {bubble}
    </>
  );
};
