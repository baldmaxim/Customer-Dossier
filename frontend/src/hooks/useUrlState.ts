// Состояние экрана в адресе: вкладка, фильтры, открытый пост. «Назад» из карточки возвращает
// туда же, ссылкой можно поделиться, перезагрузка ничего не теряет.
//
// Два режима истории:
//   'replace' (по умолчанию) — фильтры, поиск, сортировка: «Назад» не должен перебирать
//   каждую букву запроса;
//   'push' — вкладки и открытый пост: «Назад» закрывает пост / возвращает прежнюю вкладку.
//
// Значение по умолчанию в адрес не пишется: чистые ссылки и одна запись на одно состояние.
// Прокрутка при смене параметра не сбрасывается (preventScrollReset): ScrollRestoration
// иначе уводил бы страницу наверх на каждый щелчок фильтра.

import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

export type UrlHistory = 'replace' | 'push';

export interface IUrlStateOptions {
  history?: UrlHistory;
}

/** Как значение живёт в адресе. serialize → null — параметр убирается. */
export interface IUrlCodec<T> {
  parse: (raw: string | null) => T;
  serialize: (value: T) => string | null;
}

/** Строка; пустая строка и значение по умолчанию в адрес не пишутся. */
export const stringParam = (fallback = ''): IUrlCodec<string> => ({
  parse: raw => raw ?? fallback,
  serialize: value => (value === '' || value === fallback ? null : value),
});

/** Целое или дробное число; мусор в адресе — значение по умолчанию. */
export const numberParam = (fallback: number | null = null): IUrlCodec<number | null> => ({
  parse: raw => {
    if (raw === null || raw.trim() === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  },
  serialize: value => (value === null || value === fallback ? null : String(value)),
});

/** Одно из перечисленных значений; неизвестное — значение по умолчанию. */
export const enumParam = <T extends string>(values: readonly T[], fallback: T): IUrlCodec<T> => ({
  parse: raw => (raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : fallback),
  serialize: value => (value === fallback ? null : value),
});

/** Флажок: «1» — да, «0» — нет; значение по умолчанию не пишется. */
export const flagParam = (fallback = false): IUrlCodec<boolean> => ({
  parse: raw => (raw === null ? fallback : raw === '1' || raw === 'true'),
  serialize: value => (value === fallback ? null : value ? '1' : '0'),
});

type Updater<T> = T | ((prev: T) => T);

const resolve = <T,>(next: Updater<T>, prev: T): T =>
  typeof next === 'function' ? (next as (value: T) => T)(prev) : next;

/**
 * Один параметр адреса как useState:
 *   const [tab, setTab] = useUrlState('tab', enumParam(TABS, 'overview'), { history: 'push' });
 *
 * Несколько параметров за одно действие (сменить режим и закрыть пост) — useUrlPatch:
 * два вызова сеттеров подряд видят один и тот же старый адрес, и второй затрёт первый.
 */
export const useUrlState = <T,>(
  key: string,
  codec: IUrlCodec<T>,
  options: IUrlStateOptions = {},
): [T, (next: Updater<T>) => void] => {
  const [params, setParams] = useSearchParams();
  const value = codec.parse(params.get(key));
  // Кодек обычно создаётся прямо в вызове (enumParam(TABS, 'overview')) — новый объект на
  // каждый рендер. Держим его в ref, чтобы сеттер не менялся от рендера к рендеру: иначе
  // эффект с сеттером в зависимостях крутился бы по кругу.
  const codecRef = useRef(codec);
  codecRef.current = codec;
  const replace = options.history !== 'push';

  const set = useCallback(
    (next: Updater<T>): void => {
      setParams(
        prev => {
          const out = new URLSearchParams(prev);
          const { parse, serialize } = codecRef.current;
          const serialized = serialize(resolve(next, parse(prev.get(key))));
          if (serialized === null) out.delete(key);
          else out.set(key, serialized);
          return out;
        },
        { replace, preventScrollReset: true },
      );
    },
    [setParams, key, replace],
  );

  return [value, set];
};

export type UrlPatch = Record<string, string | number | boolean | null | undefined>;

/**
 * Поменять несколько параметров одной записью истории. null, undefined, '' и false
 * параметр убирают, true пишется как «1».
 */
export const useUrlPatch = (): ((patch: UrlPatch, options?: IUrlStateOptions) => void) => {
  const [, setParams] = useSearchParams();
  return useCallback(
    (patch: UrlPatch, options: IUrlStateOptions = {}): void => {
      setParams(
        prev => {
          const out = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === undefined || value === '' || value === false) out.delete(key);
            else out.set(key, value === true ? '1' : String(value));
          }
          return out;
        },
        { replace: options.history !== 'push', preventScrollReset: true },
      );
    },
    [setParams],
  );
};
