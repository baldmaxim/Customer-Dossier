import { ApiError } from '../api/client';

/**
 * Ошибка загрузки — текстом, отличимым от пустого результата (этап 15B): нет соединения, нет входа, нет прав,
 * не найдено, сбой сервера. Пустой список — это успешный ответ, а не ошибка.
 */
export const describeLoadError = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Нет входа: сессия истекла, войдите заново.';
    if (err.status === 403) return 'Запрос отклонён защитой (CSRF/Origin) — обновите страницу.';
    if (err.status === 404) return `Не найдено: ${err.message}`;
    if (err.status >= 500) return `Сбой сервера (${err.status}): ${err.message}. Данные не получены — это не пустой результат.`;
    return `Ошибка ${err.status}: ${err.message}`;
  }
  if (err instanceof TypeError) return 'Нет соединения с API: сервер не запущен или сеть недоступна. Данные не получены.';
  return err instanceof Error ? err.message : 'Неизвестная ошибка загрузки';
};
