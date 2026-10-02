// Обновление сведений Контур.Фокуса по расписанию (FOCUS_ENABLED, ADR-015).
//
// Проход — раз в FOCUS_TICK_MS: компании, чей срок пришёл, по одной, с паузой между ними. Сколько
// компаний за проход — не больше, чем позволяет остаток суточного лимита. Без ключа проход ничего не
// делает; ключ, заданный в админке, подхватывается следующим проходом.

import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { focusApiKey, loadStoredFocusKey } from '../settings/focusKey.js';
import { FOCUS_METHODS } from './client.js';
import { syncFocusIdentity } from './identity.js';
import { newPassState, refreshFocusTarget, type FocusRefreshResult } from './refresh.js';
import { pgFocusStore, SCHEDULER_ACTOR } from './store.js';
import { dueFocusTargets } from './targets.js';

const FOCUS_TICK_MS = 10 * 60_000;
/** Компаний за проход: проход короткий, очередь не держит процесс. */
const MAX_TARGETS_PER_PASS = 10;
/** Пауза между компаниями: Фокус — чужой сервис, не дёргаем его залпом. */
const DELAY_BETWEEN_TARGETS_MS = 1500;

export interface IFocusPassReport {
  skipped: 'no_key' | 'limit' | null;
  results: Array<{ identifier: string; result: FocusRefreshResult }>;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

export const runFocusPass = async (signal?: AbortSignal): Promise<IFocusPassReport> => {
  await loadStoredFocusKey();
  const key = focusApiKey();
  if (key === null) return { skipped: 'no_key', results: [] };
  const used = await pgFocusStore.usedLastDay();
  const room = Math.floor((env.FOCUS_DAILY_LIMIT - used) / FOCUS_METHODS.length);
  if (room < 1) return { skipped: 'limit', results: [] };

  const targets = await dueFocusTargets(getPool(), Math.min(MAX_TARGETS_PER_PASS, room));
  const state = newPassState();
  const results: IFocusPassReport['results'] = [];
  for (const [i, target] of targets.entries()) {
    if (signal?.aborted) break;
    if (i > 0) await sleep(DELAY_BETWEEN_TARGETS_MS, signal);
    const result = await refreshFocusTarget(target, SCHEDULER_ACTOR, {
      store: pgFocusStore,
      key,
      dailyLimit: env.FOCUS_DAILY_LIMIT,
      refreshDays: env.FOCUS_REFRESH_DAYS,
      state,
    });
    results.push({ identifier: `${target.type}:${target.value}`, result });
    // Наименование ЕГРЮЛ — в написания компании и в имя карточки, заведённой по реквизиту (ADR-016).
    if (result.status === 'found') await syncFocusIdentity(getPool(), target);
    if (result.status === 'stopped') break;
  }
  return { skipped: null, results };
};

export const startFocusScheduler = (signal: AbortSignal): void => {
  let running = false;
  // Пропуск печатаем один раз, а не каждые десять минут.
  let reported: string | null = null;

  const tick = async (): Promise<void> => {
    if (running || signal.aborted) return;
    running = true;
    try {
      const pass = await runFocusPass(signal);
      const stopped = pass.results.find(r => r.result.status === 'stopped')?.result;
      const reason = pass.skipped ?? (stopped?.status === 'stopped' ? stopped.reason : null);
      if (reason !== null && reason !== reported) {
        const text: Record<string, string> = {
          no_key: 'ключ не задан — запросов нет (админка → Источники → Контур.Фокус)',
          limit: `суточный лимит запросов исчерпан (FOCUS_DAILY_LIMIT=${env.FOCUS_DAILY_LIMIT}) — продолжим, когда освободится`,
          key_rejected: 'Фокус не принял ключ — обновление остановлено до замены ключа',
          quota_exhausted: 'тариф Фокуса исчерпан — обновление остановлено',
          rate_limited: 'Фокус просит реже — продолжим следующим проходом',
        };
        console.warn(`[focus] ${text[reason] ?? reason}`);
      }
      reported = reason;
      const found = pass.results.filter(r => r.result.status === 'found');
      const changed = found.filter(r => r.result.status === 'found' && r.result.saved > 0).length;
      if (found.length > 0) console.log(`[focus] обновлено компаний: ${found.length}, с изменениями: ${changed}`);
      for (const r of pass.results.filter(x => x.result.status === 'failed')) {
        console.warn(`[focus] ${r.identifier}: ${r.result.status === 'failed' ? r.result.error : ''}`);
      }
    } catch (err) {
      console.error(`[focus] проход упал: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), FOCUS_TICK_MS);
  signal.addEventListener('abort', () => clearInterval(timer));
  void tick();
};
