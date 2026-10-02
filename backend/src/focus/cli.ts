// Контур.Фокус из консоли (ADR-015):
//
//   npm run focus -- --status             ключ (откуда, без значения), лимит, сколько компаний можно спросить
//   npm run focus -- --probe <ИНН|ОГРН>   живой запрос req + egrDetails: имена полей ответа и строки карточки;
//                                         снимков не пишет, но запросы списываются с тарифа и идут в журнал
//   npm run focus -- --refresh <ИНН|ОГРН> обновить один реквизит, как кнопка в карточке
//   npm run focus -- --pass               один проход расписания сейчас
//   npm run focus -- --suggest <название> живой запрос suggest (поиск по названию, ADR-016): имена полей
//                                         элементов и что из них стало бы подсказкой; ничего не пишет, кроме журнала
//
// Ключ — из админки (база) или FOCUS_API_KEY; его значение не печатается.

import { env } from '../config/env.js';
import { closeDb, getPool } from '../db/pool.js';
import { focusApiKey, loadStoredFocusKey } from '../settings/focusKey.js';
import { callFocus, callFocusSuggest, FOCUS_METHODS, type IFocusIdentifier } from './client.js';
import { availablePaths, mapMethod } from './map.js';
import { refreshFocusTarget } from './refresh.js';
import { runFocusPass } from './scheduler.js';
import { pickSuggestions, suggestionView } from './suggest.js';
import { pgFocusStore } from './store.js';
import { focusCoverage } from './targets.js';

const argValue = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
};

/** 10 или 12 цифр — ИНН, 13 или 15 — ОГРН/ОГРНИП. */
const parseIdentifier = (raw: string | null): IFocusIdentifier | null => {
  const value = raw?.trim() ?? '';
  if (/^(\d{10}|\d{12})$/.test(value)) return { type: 'inn', value };
  if (/^(\d{13}|\d{15})$/.test(value)) return { type: 'ogrn', value };
  return null;
};

const status = async (): Promise<void> => {
  const key = await loadStoredFocusKey();
  const keyLine =
    key.source === 'admin' ? `из админки, оканчивается на …${key.hint ?? ''}` : key.source === 'env' ? 'из FOCUS_API_KEY в .env' : 'не задан';
  console.log(`[focus] ключ: ${keyLine}${key.problem ? ` (проблема: ${key.problem})` : ''}`);
  console.log(`[focus] по расписанию: ${env.FOCUS_ENABLED ? `да, раз в ${env.FOCUS_REFRESH_DAYS} дн.` : 'нет (FOCUS_ENABLED=false)'}`);
  console.log(`[focus] запросов за сутки: ${await pgFocusStore.usedLastDay()} из ${env.FOCUS_DAILY_LIMIT}`);
  const c = await focusCoverage(getPool());
  console.log(
    `[focus] компаний с реквизитом: ${c.companies} (разных реквизитов ${c.identifiers}); найдено ${c.found}, Фокус не знает ${c.notFound}, ждут запроса ${c.due}, с ошибкой ${c.failing}`,
  );
};

const probe = async (target: IFocusIdentifier): Promise<void> => {
  await loadStoredFocusKey();
  const key = focusApiKey();
  if (key === null) throw new Error('ключ Контур.Фокуса не задан (админка → Источники → Контур.Фокус или FOCUS_API_KEY)');
  const used = await pgFocusStore.usedLastDay();
  if (used + FOCUS_METHODS.length > env.FOCUS_DAILY_LIMIT) throw new Error(`суточный лимит: ${used} из ${env.FOCUS_DAILY_LIMIT}`);
  for (const method of FOCUS_METHODS) {
    const res = await callFocus(method, target, key);
    await pgFocusStore.journal({
      method,
      identifiersCount: 1,
      httpStatus: res.ok ? res.httpStatus : res.httpStatus,
      outcome: res.ok ? 'ok' : res.failure === 'forbidden' ? (method === 'req' ? 'key_rejected' : 'method_forbidden') : res.failure,
      error: res.ok ? null : res.error,
      actor: 'cli-probe',
    });
    if (!res.ok) {
      console.log(`[focus] ${method}: ${res.failure}${res.httpStatus ? ` (HTTP ${res.httpStatus})` : ''} — ${res.error}`);
      continue;
    }
    const item = res.items.find(i => i[target.type] === target.value);
    console.log(`[focus] ${method}: HTTP ${res.httpStatus}, элементов ${res.items.length}${item ? '' : ', нужной компании среди них нет'}`);
    if (!item) continue;
    console.log(`[focus] ${method}: поля ответа — ${availablePaths(item.payload).join(', ')}`);
    for (const f of mapMethod(method, item.payload)) console.log(`  ${f.label}: ${f.value}`);
  }
};

const suggest = async (q: string): Promise<void> => {
  await loadStoredFocusKey();
  const key = focusApiKey();
  if (key === null) throw new Error('ключ Контур.Фокуса не задан (админка → Источники → Контур.Фокус или FOCUS_API_KEY)');
  const used = await pgFocusStore.usedLastDay();
  if (used + 1 > env.FOCUS_DAILY_LIMIT) throw new Error(`суточный лимит: ${used} из ${env.FOCUS_DAILY_LIMIT}`);
  const res = await callFocusSuggest(q, key);
  await pgFocusStore.journal({
    method: 'suggest',
    identifiersCount: 1,
    httpStatus: res.httpStatus,
    outcome: res.ok ? 'ok' : res.failure === 'forbidden' ? 'key_rejected' : res.failure,
    error: res.ok ? null : res.error,
    actor: 'cli-probe',
  });
  if (!res.ok) {
    console.log(`[focus] suggest: ${res.failure}${res.httpStatus ? ` (HTTP ${res.httpStatus})` : ''} — ${res.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[focus] suggest: HTTP ${res.httpStatus}, элементов ${res.items.length}`);
  const first = res.items[0];
  if (first) console.log(`[focus] suggest: поля первого элемента — ${availablePaths(first.payload).join(', ')}`);
  const picked = pickSuggestions(q, res.items);
  console.log(`[focus] подсказками стали бы ${picked.length}:`);
  for (const item of picked) {
    const v = suggestionView(item.payload, item.inn, item.ogrn);
    console.log(`  ${v.name ?? '(без названия)'} — ИНН ${v.inn ?? '—'}, ОГРН ${v.ogrn ?? '—'}${v.status ? `, ${v.status}` : ''}${v.address ? `, ${v.address}` : ''}`);
  }
};

const refresh = async (target: IFocusIdentifier): Promise<void> => {
  await loadStoredFocusKey();
  const result = await refreshFocusTarget(target, 'cli', {
    store: pgFocusStore,
    key: focusApiKey(),
    dailyLimit: env.FOCUS_DAILY_LIMIT,
    refreshDays: env.FOCUS_REFRESH_DAYS,
  });
  console.log(`[focus] ${target.type} ${target.value}: ${JSON.stringify(result)}`);
  if (result.status === 'stopped' || result.status === 'failed') process.exitCode = 1;
};

const main = async (): Promise<void> => {
  if (process.argv.includes('--status')) return status();
  if (process.argv.includes('--suggest')) {
    const q = argValue('--suggest')?.trim() ?? '';
    if (q.length < 2) throw new Error('--suggest: укажите название, от двух символов');
    return suggest(q);
  }
  if (process.argv.includes('--pass')) {
    const pass = await runFocusPass();
    console.log(`[focus] проход: ${pass.skipped ? `пропущен (${pass.skipped})` : `компаний ${pass.results.length}, имён ${pass.names.length}`}`);
    for (const r of pass.results) console.log(`  ${r.identifier}: ${JSON.stringify(r.result)}`);
    for (const n of pass.names) console.log(`  имя #${n.companyId}: ${JSON.stringify(n.result)}`);
    return;
  }
  for (const flag of ['--probe', '--refresh'] as const) {
    if (!process.argv.includes(flag)) continue;
    const target = parseIdentifier(argValue(flag));
    if (!target) throw new Error(`${flag}: ожидается ИНН (10 или 12 цифр) или ОГРН (13 или 15 цифр)`);
    return flag === '--probe' ? probe(target) : refresh(target);
  }
  console.log('npm run focus -- --status | --probe <ИНН|ОГРН> | --refresh <ИНН|ОГРН> | --suggest <название> | --pass');
};

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    console.error('[focus] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
