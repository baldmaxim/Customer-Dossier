// Ключ идемпотентности для изменяющих запросов (решения, слияния): повтор того же запроса
// сервер узнаёт по ключу и не записывает дважды. Новый ключ — на каждое новое намерение,
// а не на каждую попытку отправки.

export const newKey = (prefix = 'ui'): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
