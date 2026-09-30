import { useEffect, useState } from 'react';

/**
 * Значение с задержкой: запрос на каждый символ поиска забивает API без пользы.
 * Пустая строка и сброс приходят с той же задержкой — вызывающий сам решает, нужен ли
 * мгновенный сброс (например, `value === '' ? '' : debounced`).
 */
export const useDebounced = <T,>(value: T, delay = 300): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};
