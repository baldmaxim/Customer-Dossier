// Один расчёт на одновременные запросы (07.10.2026). Карточка компании открывает «Объекты», «Кто строит»,
// «Сроки и продажи» и «Сайт компании» параллельно, и каждый считал объекты компании заново — 3–4 раза
// за одно открытие. Пока расчёт по ключу идёт, новый вызов получает тот же промис; после завершения
// запись удаляется, так что кэша нет и свежесть та же, что без общего расчёта.
//
// Результат один на всех вызвавших: менять его нельзя, только читать.

export const shareInFlight = <K, T>(compute: (key: K) => Promise<T>): ((key: K) => Promise<T>) => {
  const pending = new Map<K, Promise<T>>();
  return key => {
    const running = pending.get(key);
    if (running) return running;
    const started = compute(key).finally(() => pending.delete(key));
    pending.set(key, started);
    return started;
  };
};
