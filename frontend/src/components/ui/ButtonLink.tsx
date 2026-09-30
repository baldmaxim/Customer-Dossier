// Ссылка в виде кнопки: «Схема связей», «Открыть объект», «К списку». Переход остаётся
// настоящей ссылкой (средний клик, Ctrl+клик, адрес в строке состояния), а не onClick с navigate.
//
// По умолчанию переход анимируется (View Transitions): ButtonLink почти всегда ведёт на другой
// экран. Для смены параметров того же экрана — viewTransition={false}.

import { FC } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

import { buttonClass, type IButtonLook } from './Button';
import { Icon, type IconName } from './Icon';

export interface IButtonLinkProps extends LinkProps, Omit<IButtonLook, 'className'> {
  icon?: IconName;
  iconEnd?: IconName;
}

export const ButtonLink: FC<IButtonLinkProps> = ({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  block = false,
  icon,
  iconEnd,
  className,
  viewTransition = true,
  children,
  ...rest
}) => {
  const iconSize = size === 'lg' ? 'md' : 'sm';
  return (
    <Link
      {...rest}
      viewTransition={viewTransition}
      className={buttonClass({ variant, size, iconOnly, block, className })}
    >
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={iconSize} />}
    </Link>
  );
};
