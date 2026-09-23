import { useEffect, useState } from 'react';

/**
 * Совпадает ли медиазапрос сейчас. Нужен там, где раскладка меняет поведение, а не только
 * вид: на широком экране публикация открывается справа сразу, на телефоне — по нажатию.
 *
 * Без matchMedia (jsdom в тестах, старые движки) считаем экран широким: это раскладка по
 * умолчанию, в которой видно и список, и выбранное.
 */
export const useMediaQuery = (query: string): boolean => {
  const get = (): boolean =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? true : window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};
