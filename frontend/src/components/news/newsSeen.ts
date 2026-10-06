// «Просмотрено до» ленты «Новое» (этап 24F) — в браузере читателя, а не на сервере: это его удобство, и читатель
// по-прежнему ничего не записывает в портал. Хранилище бывает недоступно (приватное окно, запрет) — тогда всё
// новое считается непрочитанным, а экран работает. Отметка только растёт; вкладки узнают о ней по событию storage.

import { useSyncExternalStore } from 'react';

const KEY = 'tginfo:news-seen-up-to';
const LOCAL_EVENT = 'tginfo:news-seen';

const read = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const markNewsSeen = (upTo: string): void => {
  const current = read();
  if (current !== null && current >= upTo) return;
  try {
    localStorage.setItem(KEY, upTo);
  } catch {
    // Хранилище недоступно — отметки нет, лента останется «новой»; это не ошибка экрана.
  }
  window.dispatchEvent(new Event(LOCAL_EVENT));
};

const subscribe = (notify: () => void): (() => void) => {
  const onStorage = (e: StorageEvent): void => {
    if (e.key === KEY) notify();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(LOCAL_EVENT, notify);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(LOCAL_EVENT, notify);
  };
};

/** Отметка «просмотрено до» (ISO) или null — ещё ничего не отмечали. */
export const useNewsSeen = (): string | null => useSyncExternalStore(subscribe, read, () => null);

export const isUnseen = (at: string, seenUpTo: string | null): boolean => seenUpTo === null || at > seenUpTo;
