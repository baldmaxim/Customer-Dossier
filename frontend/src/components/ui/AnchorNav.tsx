// Меню разделов длинной страницы: полоса якорей прилипает под шапкой и подсвечивает раздел,
// который сейчас читают (aria-current="location"). Не вкладки: все разделы на одной странице,
// ссылка ведёт к месту, а не переключает содержимое.
//
// Ссылки — настоящие (#раздел в адресе, replace: «Назад» не перебирает якоря). Раскрыть
// свёрнутый раздел и довести до него взгляд — дело страницы: она видит hash в адресе.
// Подсветка — IntersectionObserver; без него (jsdom, старые движки) меню просто без подсветки.

import { FC, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { scrollIntoRow } from './scrollIntoRow';
import styles from './AnchorNav.module.css';

export interface IAnchorNavItem {
  /** id раздела на странице. */
  id: string;
  label: string;
}

export interface IAnchorNavProps {
  /** Имя навигации для диктора: «Разделы». */
  label: string;
  items: ReadonlyArray<IAnchorNavItem>;
  className?: string;
}

/** Высота липкой шапки (scroll-padding-top корня) и самой полосы: выше этой линии раздел уже прочитан. */
const stickyOffset = (nav: HTMLElement | null): number =>
  (Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + (nav?.offsetHeight ?? 0);

export const AnchorNav: FC<IAnchorNavProps> = ({ label, items, className }) => {
  const { search, hash } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState<string | null>(hash ? decodeURIComponent(hash.slice(1)) : null);
  const ids = items.map(item => item.id).join(' ');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const order = ids.split(' ');
    const seen = new Map<string, boolean>();
    // Полоса чтения — от низа липкой шапки до 45 % окна: текущий — первый раздел, который в неё заходит.
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        const current = order.find(id => seen.get(id));
        if (current) setActive(current);
      },
      { rootMargin: `-${Math.round(stickyOffset(navRef.current))}px 0px -55% 0px` },
    );
    for (const id of order) {
      const target = document.getElementById(id);
      if (target) observer.observe(target);
    }
    return () => observer.disconnect();
  }, [ids]);

  useEffect(() => {
    const list = listRef.current;
    scrollIntoRow(list, list?.querySelector<HTMLElement>('[aria-current="location"]'));
  }, [active]);

  return (
    <nav ref={navRef} aria-label={label} className={[styles.nav, className ?? ''].filter(Boolean).join(' ')}>
      <ul ref={listRef} className={styles.list}>
        {items.map(item => (
          <li key={item.id} className={styles.item}>
            <Link
              to={{ search, hash: item.id }}
              replace
              preventScrollReset
              viewTransition={false}
              aria-current={active === item.id ? 'location' : undefined}
              className={styles.link}
              onClick={() => setActive(item.id)}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};
