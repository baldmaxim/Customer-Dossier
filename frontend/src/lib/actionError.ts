// Текст отказа изменяющего действия для тоста. Сервер объясняет отказ сам («источник с
// документами удалить нельзя») — это и показываем; сеть, сессия, права и сбой сервера —
// словами describeLoadError, а не «Failed to fetch» и не «Ошибка 403».

import { ApiError } from '../api/client';
import { describeLoadError } from './loadError';

export const actionError = (err: unknown): string =>
  err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403
    ? err.message
    : describeLoadError(err);
