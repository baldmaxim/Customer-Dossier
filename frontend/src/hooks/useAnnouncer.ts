import { useCallback, useEffect, useRef, useState } from 'react';

/** Пауза между очисткой и новым текстом: иначе одинаковый текст подряд не прозвучит. */
const GAP_MS = 60;

/**
 * Объявление для диктора через live-регион: [текст для региона, объявить(текст)].
 * Регион должен быть в DOM заранее — диктор объявляет изменения, а не появление.
 */
export const useAnnouncer = (): [string, (text: string) => void] => {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const announce = useCallback((text: string): void => {
    clearTimeout(timer.current);
    setMessage('');
    timer.current = setTimeout(() => setMessage(text), GAP_MS);
  }, []);

  return [message, announce];
};
