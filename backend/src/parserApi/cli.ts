// parser-api.com из консоли (этап 24A):
//
//   npm run parserapi -- --status                        ключ (откуда, без значения), лимиты, расход, охват
//   npm run parserapi -- --probe <метод> <ИНН> [--id X]  один живой запрос: признак успеха, код отказа, имена
//                                                        полей ответа, размеры списков и числа верхнего уровня
//                                                        (count, pages) — без имён и сумм; снимков
//                                                        не пишет, но запрос занимает место в лимите и идёт в журнал
//   npm run parserapi -- --refresh <ИНН> [--dataset d]   проверить наборы ИНН, как кнопка в карточке
//   npm run parserapi -- --pass                          один проход расписания сейчас
//
// Методы пробы: bo_search, bo_details (--id из bo_search), pb_org, kad_search, fssp_ur, fedresurs_ur,
// fedresurs_org (--id из fedresurs_ur). Ключ — из админки (база) или PARSER_API_KEY; значение не печатается.

import { env } from '../config/env.js';
import { closeDb, getPool } from '../db/pool.js';
import { loadStoredParserApiKey, parserApiKey } from '../settings/parserApiKey.js';
import { asObject, availablePaths, callParserApi, isParserApiMethod, PARSER_API_METHODS, type ParserApiMethod } from './client.js';
import { COURTS_WINDOW_MONTHS, isParserApiDataset, PARSER_API_DATASETS, windowFrom } from './datasets.js';
import { parserApiCoverage } from './read.js';
import { refreshParserApiDatasets } from './refresh.js';
import { runParserApiPass } from './scheduler.js';
import { pgParserApiStore } from './store.js';

const argValue = (flag: string, offset = 1): string | null => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + offset] ?? null);
};

const parseInn = (raw: string | null): string | null => {
  const value = raw?.trim() ?? '';
  return /^(\d{10}|\d{12})$/.test(value) ? value : null;
};

const limits = () => ({ daily: env.PARSER_API_DAILY_LIMIT, monthly: env.PARSER_API_MONTHLY_LIMIT });

const requireKey = async (): Promise<string> => {
  await loadStoredParserApiKey();
  const key = parserApiKey();
  if (key === null) throw new Error('ключ parser-api.com не задан (админка → Источники → parser-api.com или PARSER_API_KEY)');
  return key;
};

const status = async (): Promise<void> => {
  const key = await loadStoredParserApiKey();
  const keyLine = key.source === 'admin' ? `из админки, оканчивается на …${key.hint ?? ''}` : key.source === 'env' ? 'из PARSER_API_KEY в .env' : 'не задан';
  console.log(`[parser-api] ключ: ${keyLine}${key.problem ? ` (проблема: ${key.problem})` : ''}`);
  console.log(`[parser-api] по расписанию: ${env.PARSER_API_ENABLED ? 'да, компании «на контроле»' : 'нет (PARSER_API_ENABLED=false)'}`);
  const usage = await pgParserApiStore.usage();
  console.log(`[parser-api] запросов: за сутки ${usage.day} из ${env.PARSER_API_DAILY_LIMIT}, за месяц ${usage.month} из ${env.PARSER_API_MONTHLY_LIMIT}`);
  const c = await parserApiCoverage(getPool());
  console.log(`[parser-api] на контроле с ИНН: ${c.watched}; наборов проверено ${c.checked}, ждут ${c.due}, с ошибкой ${c.failing}`);
};

/** Параметры пробы по методу: те же, что шлёт набор (parserApi/datasets.ts). */
const probeParams = (method: ParserApiMethod, inn: string, id: string | null): Record<string, string> => {
  switch (method) {
    case 'bo_search':
    case 'pb_org':
    case 'fssp_ur':
      return { inn };
    case 'kad_search':
      return { Inn: inn, InnType: 'Any', DateFrom: windowFrom(new Date(), COURTS_WINDOW_MONTHS), page: '1' };
    case 'fedresurs_ur':
      return { orgCode: inn };
    case 'bo_details':
    case 'fedresurs_org':
      if (!id) throw new Error(`${method}: нужен --id из ответа поиска`);
      return { id };
  }
};

const probe = async (method: ParserApiMethod, inn: string, id: string | null): Promise<void> => {
  const key = await requireKey();
  const reserved = await pgParserApiStore.reserve({ method, inn, page: null, actor: 'cli-probe' }, limits());
  if (!reserved.ok) throw new Error(`лимит портала: сутки ${reserved.usage.day} из ${env.PARSER_API_DAILY_LIMIT}, месяц ${reserved.usage.month} из ${env.PARSER_API_MONTHLY_LIMIT}`);
  const res = await callParserApi(method, probeParams(method, inn, id), key);
  await pgParserApiStore.finish(
    reserved.id,
    res.ok ? { outcome: 'ok', httpStatus: res.httpStatus, apiCode: null, error: null } : { outcome: res.failure, httpStatus: res.httpStatus, apiCode: res.apiCode, error: res.error },
  );
  if (!res.ok) {
    console.log(`[parser-api] ${method}: ${res.failure}${res.httpStatus ? ` (HTTP ${res.httpStatus})` : ''}${res.apiCode ? `, код ${res.apiCode}` : ''} — ${res.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[parser-api] ${method}: HTTP ${res.httpStatus}, успех`);
  for (const [name, value] of Object.entries(res.body)) {
    if (Array.isArray(value)) console.log(`  список ${name}: ${value.length} элементов`);
    else if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) console.log(`  число ${name}: ${value}`);
    else if (asObject(value)) console.log(`  объект ${name}`);
  }
  console.log(`[parser-api] ${method}: поля ответа — ${availablePaths(res.body).join(', ')}`);
};

const refresh = async (inn: string, dataset: string | null): Promise<void> => {
  const key = await requireKey();
  if (dataset !== null && !isParserApiDataset(dataset)) throw new Error(`--dataset: один из ${PARSER_API_DATASETS.join(', ')}`);
  const result = await refreshParserApiDatasets(inn, dataset ? [dataset] : PARSER_API_DATASETS, 'cli', {
    store: pgParserApiStore,
    key,
    limits: limits(),
    kadMaxPages: env.PARSER_API_KAD_MAX_PAGES,
  });
  console.log(`[parser-api] ИНН ${inn}: ${JSON.stringify(result)}`);
  if (result.status === 'stopped') process.exitCode = 1;
};

const main = async (): Promise<void> => {
  if (process.argv.includes('--status')) return status();
  if (process.argv.includes('--pass')) {
    const pass = await runParserApiPass();
    console.log(`[parser-api] проход: ${pass.skipped ? `пропущен (${pass.skipped})` : `компаний ${pass.results.length}`}`);
    for (const r of pass.results) console.log(`  #${r.companyId}: ${JSON.stringify(r.result)}`);
    return;
  }
  if (process.argv.includes('--probe')) {
    const method = argValue('--probe') ?? '';
    const inn = parseInn(argValue('--probe', 2));
    if (!isParserApiMethod(method)) throw new Error(`--probe: метод — один из ${Object.keys(PARSER_API_METHODS).join(', ')}`);
    if (!inn) throw new Error('--probe <метод> <ИНН>: ИНН — 10 или 12 цифр');
    return probe(method, inn, argValue('--id'));
  }
  if (process.argv.includes('--refresh')) {
    const inn = parseInn(argValue('--refresh'));
    if (!inn) throw new Error('--refresh: ожидается ИНН (10 или 12 цифр)');
    return refresh(inn, argValue('--dataset'));
  }
  console.log('npm run parserapi -- --status | --probe <метод> <ИНН> [--id X] | --refresh <ИНН> [--dataset d] | --pass');
};

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    console.error('[parser-api] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
