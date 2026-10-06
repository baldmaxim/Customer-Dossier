// parser-api.com (этап 24A, ADR-017): состояние наборов на карточке компании, «Обновить» и настройка в админке.
//
// Права — auth/routePolicy.ts: чтение карточки — portal.read, «Обновить» — sources.manage (каждый ответ —
// запрос тарифа), состояние в админке — admin.view, ключ — parserapi.manage (только администратор).
// Ключ в ответ не попадает никогда: только источник, четыре последних символа, кто и когда задал.

import type { Request, Response } from 'express';
import { z } from 'zod';

import { actorOfContext, LOCAL_CONTEXT } from '../auth/service.js';
import { env } from '../config/env.js';
import { getPool, query } from '../db/pool.js';
import { checkParserApiKey } from '../parserApi/client.js';
import { isParserApiDataset, PARSER_API_DATASETS, type ParserApiDataset } from '../parserApi/datasets.js';
import { loadParserApiStates, parserApiConnection, parserApiCoverage } from '../parserApi/read.js';
import { refreshParserApiDatasets, type ParserApiStopReason } from '../parserApi/refresh.js';
import { pgParserApiStore } from '../parserApi/store.js';
import { companyInn } from '../parserApi/targets.js';
import { clearParserApiKey, loadStoredParserApiKey, normalizeParserApiKey, parserApiKey, saveParserApiKey } from '../settings/parserApiKey.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const parserApiRouter = asyncRouter();

const actorOf = (req: Request): string => actorOfContext(req.auth ?? LOCAL_CONTEXT).login;

const keySchema = z.object({ key: z.string().max(1024) }).strict();
const refreshSchema = z.object({ datasets: z.array(z.string()).max(PARSER_API_DATASETS.length).optional() }).strict();

/** Чаще раза в 10 минут один набор не спрашиваем: двойное нажатие не должно стоить двух запросов. */
const MANUAL_REFRESH_GAP_MS = 10 * 60_000;
const RECENT_REQUESTS = 30;

const parseId = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const sendError = (res: Response, status: number, error: string, code: string): void => {
  res.status(status).json({ error, code });
};

export const STOP_ERRORS: Record<ParserApiStopReason, { status: number; error: string }> = {
  no_key: { status: 409, error: 'parser-api.com не подключён: ключ не задан' },
  daily_limit: { status: 429, error: 'Суточный лимит запросов к parser-api.com исчерпан' },
  monthly_limit: { status: 429, error: 'Месячный лимит запросов к parser-api.com исчерпан' },
  key_rejected: { status: 502, error: 'parser-api.com не принял ключ — его нужно заменить в админке' },
  subscription_expired: { status: 502, error: 'Подписка parser-api.com истекла' },
  ip_rejected: { status: 502, error: 'parser-api.com не разрешает запросы с адреса портала — адрес добавляют в личном кабинете сервиса' },
};

const limits = () => ({ daily: env.PARSER_API_DAILY_LIMIT, monthly: env.PARSER_API_MONTHLY_LIMIT });

const INN_PROBLEMS = {
  no_inn: 'У компании нет ИНН с верной контрольной суммой — реестры ищут по ИНН',
  several_inns: 'У компании несколько разных ИНН — сначала нужно разобраться, какой её',
} as const;

parserApiRouter.get('/companies/:id/parser-api', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    sendError(res, 400, 'Некорректный id', 'bad_id');
    return;
  }
  const target = await companyInn(getPool(), id);
  res.json({
    configured: parserApiKey() !== null,
    scheduled: env.PARSER_API_ENABLED,
    inn: target.ok ? target.inn : null,
    problem: target.ok ? null : target.problem,
    datasets: target.ok ? await loadParserApiStates(getPool(), target.inn) : [],
  });
});

parserApiRouter.post('/companies/:id/parser-api/refresh', async (req, res) => {
  const id = parseId(req.params.id);
  const parsed = refreshSchema.safeParse(req.body ?? {});
  if (id === null || !parsed.success) {
    sendError(res, 400, 'Некорректный запрос', 'bad_request');
    return;
  }
  const requested = parsed.data.datasets ?? [...PARSER_API_DATASETS];
  if (!requested.every(isParserApiDataset)) {
    sendError(res, 400, 'Неизвестный набор сведений', 'bad_dataset');
    return;
  }
  const target = await companyInn(getPool(), id);
  if (!target.ok) {
    sendError(res, 422, INN_PROBLEMS[target.problem], target.problem);
    return;
  }
  const recent = await query<{ dataset: ParserApiDataset }>(
    `SELECT dataset FROM parser_api_checks WHERE inn = $1 AND checked_at > now() - $2::int * interval '1 millisecond'`,
    [target.inn, MANUAL_REFRESH_GAP_MS],
  );
  const fresh = new Set(recent.map(r => r.dataset));
  const datasets = PARSER_API_DATASETS.filter(d => (requested as string[]).includes(d) && !fresh.has(d));
  if (datasets.length === 0) {
    sendError(res, 409, 'Сведения получены меньше 10 минут назад — обновлять чаще незачем', 'parser_api_fresh');
    return;
  }
  const result = await refreshParserApiDatasets(target.inn, datasets, actorOf(req), {
    store: pgParserApiStore,
    key: parserApiKey(),
    limits: limits(),
    kadMaxPages: env.PARSER_API_KAD_MAX_PAGES,
  });
  const states = await loadParserApiStates(getPool(), target.inn);
  if (result.status === 'stopped') {
    const { status, error } = STOP_ERRORS[result.reason];
    res.status(status).json({ error, code: `parser_api_${result.reason}`, datasets: result.datasets, states });
    return;
  }
  res.json({ datasets: result.datasets, states });
});

parserApiRouter.get('/admin/parser-api', async (_req, res) => {
  const key = await loadStoredParserApiKey();
  const [usage, coverage, connection, recent] = await Promise.all([
    pgParserApiStore.usage(),
    parserApiCoverage(getPool()),
    parserApiConnection(getPool(), key.source !== 'none', key.source === 'admin' ? key.updatedAt : null),
    query(
      `SELECT requested_at AS "requestedAt", method, inn, page, http_status AS "httpStatus", api_code AS "apiCode",
              outcome, billable, error, actor
       FROM parser_api_requests ORDER BY requested_at DESC, id DESC LIMIT $1`,
      [RECENT_REQUESTS],
    ),
  ]);
  res.json({
    key,
    connection,
    enabled: env.PARSER_API_ENABLED,
    limits: limits(),
    kadMaxPages: env.PARSER_API_KAD_MAX_PAGES,
    usage,
    coverage,
    recent,
  });
});

const SAVE_ERRORS = {
  invalid_key: { status: 400, error: 'Ключ — одна строка без пробелов, как его выдал сервис' },
  no_db_password: { status: 409, error: 'В DATABASE_URL нет пароля — ключ в базе нечем зашифровать. Задайте PARSER_API_KEY в .env' },
  store_missing: { status: 503, error: 'Хранилища ключей нет — примените миграцию 032' },
  unknown_name: { status: 503, error: 'Хранилище ключей не знает ключ parser-api — примените миграцию 044' },
} as const;

const REJECTED_TEXT: Record<string, string> = {
  key_rejected: 'parser-api.com не принял ключ — он не сохранён',
  subscription_expired: 'Подписка по этому ключу истекла — ключ не сохранён',
  ip_rejected: 'parser-api.com не разрешает запросы с адреса портала — ключ не сохранён; адрес добавляют в личном кабинете сервиса',
};

parserApiRouter.put('/admin/parser-api/key', async (req, res) => {
  const parsed = keySchema.safeParse(req.body);
  const key = parsed.success ? normalizeParserApiKey(parsed.data.key) : null;
  if (key === null) {
    sendError(res, SAVE_ERRORS.invalid_key.status, SAVE_ERRORS.invalid_key.error, 'invalid_key');
    return;
  }
  // Проверка до записи — без расхода тарифа: ловит опечатку, истёкшую подписку и чужой адрес.
  const check = await checkParserApiKey(key);
  try {
    const reserved = await pgParserApiStore.reserve({ method: 'key_check', inn: null, page: null, actor: actorOf(req) }, { daily: Number.MAX_SAFE_INTEGER, monthly: Number.MAX_SAFE_INTEGER });
    if (reserved.ok) {
      await pgParserApiStore.finish(reserved.id, {
        outcome: check.failure ?? 'ok',
        httpStatus: check.httpStatus,
        apiCode: check.apiCode,
        error: check.error,
      });
    }
  } catch (err) {
    // Без миграции 044 журнала нет; сохранение ниже скажет это словами (unknown_name), а не 500.
    if ((err as { code?: string }).code !== '42P01') throw err;
  }
  if (check.verdict === 'rejected') {
    sendError(res, 422, REJECTED_TEXT[check.failure ?? 'key_rejected'] ?? REJECTED_TEXT.key_rejected!, check.failure ?? 'key_rejected');
    return;
  }
  const saved = await saveParserApiKey(key, actorOf(req));
  if (!saved.ok) {
    const { status, error } = SAVE_ERRORS[saved.code];
    sendError(res, status, error, saved.code);
    return;
  }
  res.json({ key: saved.status, check: { verdict: check.verdict, error: check.error } });
});

parserApiRouter.delete('/admin/parser-api/key', async (req, res) => {
  res.json({ key: await clearParserApiKey(actorOf(req)) });
});
