// Загрузка — одним видом на весь портал и с объявлением для диктора (role="status").
// Раньше «Загрузка…» была голым текстом в 24 местах, а каталог при загрузке был просто пуст.
//
//   <Loading />                                    — строка «Загрузка…» со спиннером
//   <Loading variant="block" label="Загружаю компанию…" />  — блок на месте содержимого
//   <Loading label="Загружаю список…"><Skeleton lines={6} height="44px" /></Loading>
//       — скелет вместо спиннера; подпись остаётся для диктора
//
// aria-busy ставится на тот контейнер, содержимое которого грузится, — это забота страницы.

import { FC, ReactNode } from 'react';

import { Icon } from './Icon';
import styles from './Loading.module.css';

export interface ILoadingProps {
  label?: string;
  /** inline — строка; block — блок с отступами на месте содержимого; page — по центру экрана. */
  variant?: 'inline' | 'block' | 'page';
  /** Скелет будущего содержимого вместо спиннера. */
  children?: ReactNode;
  className?: string;
}

export const Loading: FC<ILoadingProps> = ({ label = 'Загрузка…', variant = 'inline', children, className }) => (
  <div
    role="status"
    className={[styles.loading, styles[variant], children ? styles.withSkeleton : '', className ?? ''].filter(Boolean).join(' ')}
  >
    {children ? (
      <>
        <span className="visually-hidden">{label}</span>
        <div aria-hidden="true" className={styles.skeleton}>
          {children}
        </div>
      </>
    ) : (
      <>
        <Icon name="spinner" size={variant === 'inline' ? 'sm' : 'md'} className={styles.spinner} />
        <span>{label}</span>
      </>
    )}
  </div>
);
