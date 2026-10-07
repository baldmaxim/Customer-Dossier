// true через ms после монтирования: отложить второстепенный запрос, чтобы он не спорил с запросами страницы.

import { useEffect, useState } from 'react';

export const useAfterDelay = (ms: number): boolean => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return ready;
};
