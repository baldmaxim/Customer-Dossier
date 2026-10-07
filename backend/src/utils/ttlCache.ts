// Короткий кэш результата по ключу (07.10.2026): одинаковый запрос в течение ttlMs отдаётся из памяти, ошибка
// не запоминается, записей не больше max (вытесняется самая старая). clear() — сброс при изменении данных.
// Результат один на всех вызвавших: менять его нельзя, только читать.

export interface ITtlCache<K, T> {
  get: (key: K) => Promise<T>;
  clear: () => void;
}

export const ttlCache = <K, T>(
  load: (key: K) => Promise<T>,
  options: { ttlMs: number; max: number; keyOf: (key: K) => string; now?: () => number },
): ITtlCache<K, T> => {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return {
    get: key => {
      const k = options.keyOf(key);
      const hit = entries.get(k);
      if (hit && now() - hit.at < options.ttlMs) return hit.value;
      const value = load(key);
      entries.delete(k);
      entries.set(k, { at: now(), value });
      value.catch(() => {
        if (entries.get(k)?.value === value) entries.delete(k);
      });
      while (entries.size > options.max) entries.delete(entries.keys().next().value as string);
      return value;
    },
    clear: () => entries.clear(),
  };
};
