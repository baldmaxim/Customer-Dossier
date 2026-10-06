// Сервисы тарифа parser-api.com, которые недавно отказали по лимиту или подписке (06.10.2026).
//
// Тариф — по сервисам: исчерпанный arbitr не мешает fssp. Отказ сервиса (40302 / 40304 / 40305) или своего лимита
// портала ставит сервис на паузу, и расписание его не спрашивает, пока пауза не пройдёт: иначе компании, чья картотека
// не проверена, стояли бы первыми в очереди всегда и забирали проход у остальных наборов. Успешный ответ сервиса паузу
// снимает. Пауза живёт в памяти процесса: после перезапуска — один отказ, он не оплачивается. Кнопка «Обновить» паузу
// не смотрит — продлённую подписку оператор проверяет сразу.

import type { ParserApiFailure } from './client.js';

const PAUSE_MS: Partial<Record<ParserApiFailure, number>> = {
  daily_limit: 3 * 60 * 60_000,
  monthly_limit: 24 * 60 * 60_000,
  subscription_expired: 24 * 60 * 60_000,
};

/** Отказ одного сервиса, а не ключа: остальные сервисы спрашиваются дальше. */
export const isServiceStop = (failure: ParserApiFailure): boolean => PAUSE_MS[failure] !== undefined;

const paused = new Map<string, { reason: ParserApiFailure; until: number }>();

export const pauseService = (service: string, reason: ParserApiFailure, now = Date.now()): void => {
  const ms = PAUSE_MS[reason];
  if (ms !== undefined) paused.set(service, { reason, until: now + ms });
};

export const resumeService = (service: string): void => {
  paused.delete(service);
};

/** Сервисы на паузе сейчас: причина и до какого момента. */
export const pausedServices = (now = Date.now()): Map<string, { reason: ParserApiFailure; until: number }> => {
  for (const [service, p] of paused) if (p.until <= now) paused.delete(service);
  return new Map(paused);
};
