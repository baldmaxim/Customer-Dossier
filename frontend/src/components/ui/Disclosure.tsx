// Раскрываемый блок на нативном <details>: работает без JS, поиск по странице сам
// раскрывает найденное. Заголовок (summary) — цель не меньше 44px, шеврон поворачивается,
// содержимое входит прозрачностью и сдвигом (высоту не анимируем).
//
// Раздел страницы, который на телефоне свёрнут, — с level: заголовок раздела остаётся
// заголовком для навигации диктора.
//
// Управляемый режим: open + onToggle. Нажатие на summary браузер обрабатывает сам и
// сообщает через toggle — вызывающий только синхронизирует своё состояние (например, в адрес).

import { FC, ReactNode, SyntheticEvent } from 'react';

import { Heading } from './Heading';
import type { HeadingLevel } from './headingLevel';
import { Icon } from './Icon';
import styles from './Disclosure.module.css';

export interface IDisclosureProps {
  summary: ReactNode;
  /** Справа в строке заголовка: счётчик, «3 из 12». */
  meta?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** plain — строка с шевроном; card — на карточке с рамкой. */
  variant?: 'plain' | 'card';
  /** Заголовок раздела внутри summary (h2–h4). */
  level?: HeadingLevel;
  id?: string;
  className?: string;
  children: ReactNode;
}

export const Disclosure: FC<IDisclosureProps> = ({
  summary,
  meta,
  defaultOpen,
  open,
  onToggle,
  variant = 'plain',
  level,
  id,
  className,
  children,
}) => (
  <details
    id={id}
    className={[styles.disclosure, styles[variant], className ?? ''].filter(Boolean).join(' ')}
    open={open ?? defaultOpen}
    onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => onToggle?.(e.currentTarget.open)}
  >
    <summary className={styles.summary}>
      <Icon name="chevron" size="md" className={styles.chevron} />
      {level ? (
        <Heading level={level} className={styles.heading}>
          {summary}
        </Heading>
      ) : (
        <span className={styles.label}>{summary}</span>
      )}
      {meta && <span className={styles.meta}>{meta}</span>}
    </summary>
    <div className={styles.content}>{children}</div>
  </details>
);
