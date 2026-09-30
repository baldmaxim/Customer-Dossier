// Таблица со своей горизонтальной прокруткой: страница по горизонтали не едет
// никогда (e2e T18-05 проверяет это на 390px).
//
// Когда таблица шире окна, область прокрутки становится фокусируемой областью с именем
// (с клавиатуры её можно листать стрелками, axe scrollable-region-focusable), а у края,
// за которым есть колонки, появляется тень-подсказка. На телефоне (< 600px) широкую
// таблицу лучше не показывать вовсе — README: «таблица → карточки».

import { FC, ReactNode, useEffect, useRef, useState } from 'react';

import styles from './TableScroll.module.css';

export interface ITableScrollProps {
  /** Имя области прокрутки для диктора: «Компании», «Источники». Без него — подпись таблицы
      или заголовок раздела. */
  label?: string;
  /** Подпись таблицы (<caption>). По умолчанию скрыта глазами: заголовок уже есть в секции. */
  caption?: ReactNode;
  captionVisible?: boolean;
  /** Ниже этой ширины таблица скроллится внутри себя. */
  minWidth?: number;
  /** Шапка липнет к верху собственного окна прокрутки (контейнер получает высоту). */
  stickyHead?: boolean;
  className?: string;
  children: ReactNode;
}

interface IEdges {
  overflow: boolean;
  start: boolean;
  end: boolean;
}

const NONE: IEdges = { overflow: false, start: false, end: false };

/**
 * Имя области без label: подпись таблицы или заголовок ближайшего раздела. Одинаковое
 * «Таблица» у трёх таблиц страницы дикторы не различают (axe landmark-unique).
 */
const fallbackLabel = (wrap: HTMLElement): string => {
  const caption = wrap.querySelector('caption')?.textContent?.trim();
  if (caption) return caption;
  const heading = wrap.closest('section')?.querySelector('h1, h2, h3, h4')?.textContent?.trim();
  return heading ? `${heading}: таблица` : 'Таблица';
};

export const TableScroll: FC<ITableScrollProps> = ({
  label,
  caption,
  captionVisible = false,
  minWidth = 720,
  stickyHead = false,
  className,
  children,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<IEdges>(NONE);
  const [autoLabel, setAutoLabel] = useState('Таблица');

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    setAutoLabel(fallbackLabel(wrap));
    const measure = (): void => {
      const max = wrap.scrollWidth - wrap.clientWidth;
      const next: IEdges =
        max > 1 ? { overflow: true, start: wrap.scrollLeft > 1, end: wrap.scrollLeft < max - 1 } : NONE;
      setEdges(prev => (prev.overflow === next.overflow && prev.start === next.start && prev.end === next.end ? prev : next));
    };
    measure();
    wrap.addEventListener('scroll', measure, { passive: true });
    // Без ResizeObserver (jsdom, старые движки) — только первый замер и прокрутка.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(wrap);
    const table = wrap.firstElementChild;
    if (table) observer?.observe(table);
    return () => {
      wrap.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      className={[styles.frame, className ?? ''].filter(Boolean).join(' ')}
      data-scroll-start={edges.start || undefined}
      data-scroll-end={edges.end || undefined}
    >
      <div
        ref={wrapRef}
        className={stickyHead ? `${styles.wrap} ${styles.tall}` : styles.wrap}
        {...(edges.overflow || stickyHead
          ? { tabIndex: 0, role: 'region', 'aria-label': label ?? autoLabel }
          : {})}
      >
        {/* Ширина динамическая — инлайн здесь разрешён правилами проекта. */}
        <table className={styles.table} style={{ minWidth }}>
          {caption && <caption className={captionVisible ? styles.caption : 'visually-hidden'}>{caption}</caption>}
          {children}
        </table>
      </div>
    </div>
  );
};
