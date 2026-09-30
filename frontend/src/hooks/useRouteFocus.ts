// Фокус и объявление при смене страницы (pathname, не query). Без этого после перехода
// фокус оставался на нажатой ссылке, которой больше нет, и диктор молчал: человек не знал,
// что страница сменилась.
//
// Куда фокус: h1 страницы (PageHeader ставит ему tabIndex=-1), а если h1 ещё нет
// (данные грузятся) — main; появится h1 в ближайшие секунды — фокус переедет на него,
// если человек сам никуда его не увёл. Прокрутку не трогаем: ей управляет ScrollRestoration.
//
// Переходы с keepFocus в state (вкладки-ссылки разделов) фокус не двигают — только объявляют.

import { RefObject, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { APP_TITLE } from './usePageTitle';

/** Состояние перехода, при котором фокус остаётся на нажатой ссылке (TabLinks). */
export const KEEP_FOCUS_STATE = { keepFocus: true } as const;

/** Сколько ждать h1, пока страница загружает данные. */
const WAIT_HEADING_MS = 5000;

const keepsFocus = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as { keepFocus?: unknown }).keepFocus === true;

const pageName = (main: HTMLElement): string => {
  const heading = main.querySelector('h1')?.textContent?.trim();
  if (heading) return heading;
  const title = document.title.replace(new RegExp(`\\s*—\\s*${APP_TITLE}$`), '').trim();
  return title || APP_TITLE;
};

const focusHeading = (main: HTMLElement): boolean => {
  const heading = main.querySelector<HTMLElement>('h1');
  if (!heading) return false;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
  return true;
};

export const useRouteFocus = (mainRef: RefObject<HTMLElement | null>, announce: (text: string) => void): void => {
  const location = useLocation();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = location.pathname;
    // Первая отрисовка (и повторный эффект StrictMode) — не переход.
    if (before === null || before === location.pathname) return undefined;
    const main = mainRef.current;
    if (!main) return undefined;

    if (keepsFocus(location.state)) {
      announce(pageName(main));
      return undefined;
    }

    if (focusHeading(main)) {
      announce(pageName(main));
      return undefined;
    }

    main.focus({ preventScroll: true });
    announce(pageName(main));
    const observer = new MutationObserver(() => {
      if (document.activeElement !== main) observer.disconnect();
      else if (focusHeading(main)) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), WAIT_HEADING_MS);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    // location.state читается в момент перехода; перезапуск по нему не нужен.
  }, [location.pathname, mainRef, announce]);
};
