// Состояние источника для оператора (этап 16, source-health@1). Чистые функции поверх уже записанных полей:
// sources.health/health_reason, last_attempt_at, cursor, последний source_runs и допуск.
//
// Состояния различаются по смыслу, а не по числу публикаций:
//  never_run        — ни одной попытки: «пусто» ничего не значит;
//  policy_blocked   — нет действующего допуска на сбор (оператор) или источник отказал в доступе (403/451);
//  degraded         — вёрстка/лента/профиль не дают записей там, где они ожидаются, или идентичность канала под вопросом;
//  temporary_error  — сеть, 5xx, 429, размер: повтор с паузой;
//  partial_history  — последний проход успешен, но есть недогруженный разрыв/хвост или лимит страниц;
//  healthy          — последний проход успешен, разрывов не записано.
// Полнота истории источника неизвестна во всех состояниях: общее число публикаций источника не наблюдается.

import { evaluateSourcePolicy, type PermissionStatus } from './policy.js';

export const SOURCE_HEALTH_VERSION = 'source-health@1' as const;

export type SourceHealthState = 'never_run' | 'healthy' | 'degraded' | 'policy_blocked' | 'temporary_error' | 'partial_history';

export interface ISourceHealthInput {
  key: string;
  accessStatus: PermissionStatus;
  aiProcessingStatus: PermissionStatus;
  policyExpiresAt: Date | string | null;
  health: string | null;
  healthReason: string | null;
  lastAttemptAt: Date | string | null;
  cursor: Record<string, unknown> | null;
  lastOutcome: string | null;
  lastCoverage: Record<string, unknown> | null;
}

export interface ISourceHealthView {
  version: typeof SOURCE_HEALTH_VERSION;
  state: SourceHealthState;
  reason: string;
  /** Что известно о полноте: всегда без общего числа публикаций источника. */
  coverage: { totalKnown: false; gaps: string[] };
  /** Допуск на ИИ отдельно от сбора: сбор может идти, а обработка — нет. */
  aiAllowed: boolean;
}

const DEGRADED = new Set(['parser_degraded', 'config_invalid', 'identity_uncertain']);
const TEMPORARY = new Set(['rate_limited', 'error']);

const gapsOf = (cursor: Record<string, unknown> | null, coverage: Record<string, unknown> | null): string[] => {
  const gaps: string[] = [];
  const tg = (cursor?.tg ?? null) as { gap?: { after?: number; before?: number } | null } | null;
  if (tg?.gap && typeof tg.gap.after === 'number' && typeof tg.gap.before === 'number') {
    gaps.push(`Telegram: посты ${tg.gap.after + 1}…${tg.gap.before - 1} ещё не догружены`);
  }
  const site = (cursor?.site ?? null) as { backlogNext?: string | null } | null;
  if (site?.backlogNext) gaps.push(`сайт: недочитанный хвост списка с ${site.backlogNext}`);
  const stop = typeof coverage?.stopReason === 'string' ? coverage.stopReason : null;
  if (stop === 'max_pages' || stop === 'failed' || stop === 'pagination_loop') gaps.push(`последний проход остановлен: ${stop}`);
  return gaps;
};

export const classifySourceHealth = (input: ISourceHealthInput, now: Date = new Date()): ISourceHealthView => {
  const expires = input.policyExpiresAt === null ? null : new Date(input.policyExpiresAt);
  const policyFields = { key: input.key, accessStatus: input.accessStatus, aiProcessingStatus: input.aiProcessingStatus, policyExpiresAt: expires };
  const collect = evaluateSourcePolicy(policyFields, 'collect', now);
  const ai = evaluateSourcePolicy(policyFields, 'ai_processing', now);
  const gaps = gapsOf(input.cursor, input.lastCoverage);
  const base = { version: SOURCE_HEALTH_VERSION, coverage: { totalKnown: false as const, gaps }, aiAllowed: ai.allowed };

  if (!collect.allowed) return { ...base, state: 'policy_blocked', reason: `сбор не допущен оператором: ${collect.reason ?? 'допуск не подтверждён'}` };
  if (input.lastAttemptAt === null) return { ...base, state: 'never_run', reason: 'попыток сбора не было — отсутствие публикаций ничего не говорит об источнике' };
  if (input.health === 'blocked' || input.lastOutcome === 'policy_blocked') {
    return { ...base, state: 'policy_blocked', reason: `источник или политика отказали в доступе: ${input.healthReason ?? input.lastOutcome ?? 'без причины'}` };
  }
  if (input.health !== null && DEGRADED.has(input.health)) {
    return { ...base, state: 'degraded', reason: input.healthReason ?? `разбор деградировал (${input.health})` };
  }
  if (input.health !== null && TEMPORARY.has(input.health)) {
    return { ...base, state: 'temporary_error', reason: input.healthReason ?? `временная ошибка (${input.health})` };
  }
  if (gaps.length > 0 || input.lastOutcome === 'partial') {
    return { ...base, state: 'partial_history', reason: gaps[0] ?? 'последний проход частичный' };
  }
  return { ...base, state: 'healthy', reason: input.lastOutcome === 'not_modified' ? 'источник ответил «не изменялось» (по заголовкам кэша)' : 'последний проход успешен, разрывов не записано' };
};

/**
 * Страница списка без записей — слом вёрстки, а не «новостей нет», если страница большая или раньше записи были.
 * Маленькая пустая страница при минимуме 0 — законная пустая лента.
 */
export const listPageDegraded = (input: { items: number; htmlLength: number; minItems: number; lastListCount: number | null }): boolean =>
  input.items < input.minItems && (input.htmlLength > 2000 || (input.lastListCount ?? 0) > 0);
