import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

const readStored = (): Theme | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    // Приватный режим или заблокированные site data — просто нет сохранённого выбора.
    return null;
  }
};

const systemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

/**
 * Тема. Первичная установка делается инлайн-скриптом в index.html до отрисовки
 * — здесь мы только читаем уже проставленный атрибут, иначе на первом кадре
 * мигнёт светлым.
 */
export const useTheme = (): { theme: Theme; toggle: () => void } => {
  const [theme, setTheme] = useState<Theme>(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return readStored() ?? systemTheme();
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Шапка PWA красится этим мета-тегом; без синхронизации она останется
    // от предыдущей темы.
    const meta = document.querySelector('meta[name="theme-color"]');
    // Значения совпадают с --bg в index.css и с инлайн-скриптом в index.html.
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0e1015' : '#f4f5f8');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Выбор не сохранится, но приложение работает — молча продолжаем.
    }
  }, [theme]);

  // Следим за системной темой, пока пользователь не выбрал свою.
  useEffect(() => {
    if (readStored() !== null) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => setTheme(e.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark')), []);

  return { theme, toggle };
};
