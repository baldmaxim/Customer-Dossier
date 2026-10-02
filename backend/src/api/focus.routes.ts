// Контур.Фокус (ADR-015): сведения ЕГРЮЛ на карточке компании и настройка в админке.
//
// Права — auth/routePolicy.ts: чтение карточки — portal.read, «Обновить» — sources.manage (каждый
// запрос — деньги тарифа), состояние в админке — admin.view, ключ — focus.manage (только администратор).
// Ключ в ответ не попадает никогда: только источник, четыре последних символа, кто и когда задал.

import type { Request, Response } from 'express';
import { z } from 'zod';

import { actorOfContext, LOCAL_CONTEXT } from '../auth/service.js';
import { env } from '../config/env.js';
import { getPool, query } from '../db/pool.js';
import { checkFocusKey } from '../focus/client.js';
import { syncFocusIdentity } from '../focus/identity.js';
import { loadCompanyFocus } from '../focus/read.js';
import { refreshFocusTarget, type FocusStopReason } from '../focus/refresh.js';
import { pgFocusStore } from '../focus/store.js';
import { companyFocusTarget, focusCoverage } from '../focus/targets.js';
import { clearFocusKey, focusApiKey, loadStoredFocusKey, normalizeFocusKey, saveFocusKey } from '../settings/focusKey.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const focusRouter = asyncRouter();

const actorOf = (req: Request): string => actorOfContext(req.auth ?? LOCAL_CONTEXT).login;

const keySchema = z.object({ key: z.string().max(1024) }).strict();

/** Чаще раза в 10 минут одну компанию не спрашиваем: двойное нажатие не должно стоить двух запросов. */
const MANUAL_REFRESH_GAP_MS = 10 * 60_000;
const RECENT_REQUESTS = 20;

const parseId = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const STOP_ERRORS: Record<FocusStopReason, { status: number; error: string }> = {
  no_key: { status: 409, error: 'Контур.Фокус не подключён: ключ не задан' },
  limit: { status: 429, error: 'Лимит запросов к Контур.Фокусу на сутки исчерпан' },
  key_rejected: { status: 502, error: 'Контур.Фокус не принял ключ — его нужно заменить в админке' },
  quota_exhausted: { status: 502, error: 'Тариф Контур.Фокуса исчерпан' },
  rate_limited: { status: 503, error: 'Контур.Фокус просит обращаться реже — попробуйте через минуту' },
};

const sendError = (res: Response, status: number, error: string, code: string): void => {
  res.status(status).json({ error, code });
};

focusRouter.get('/companies/:id/focus', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    sendError(res, 400, 'Некорректный id', 'bad_id');
    return;
  }
  res.json(await loadCompanyFocus(getPool(), id));
});

focusRouter.post('/companies/:id/focus/refresh', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    sendError(res, 400, 'Некорректный id', 'bad_id');
    return;
  }
  const resolved = await companyFocusTarget(getPool(), id);
  if (!resolved.ok) {
    sendError(
      res,
      422,
      resolved.problem === 'no_identifier'
        ? 'У компании нет ИНН или ОГРН — Контур.Фокус ищет только по реквизитам'
        : 'У компании несколько разных ИНН или ОГРН — сначала нужно разобраться, какой её',
      resolved.problem,
    );
    return;
  }
  const { target } = resolved;
  const last = await query<{ checked_at: Date }>(
    'SELECT checked_at FROM focus_checks WHERE identifier_type = $1 AND identifier = $2 AND checked_at IS NOT NULL',
    [target.type, target.value],
  );
  const checkedAt = last[0]?.checked_at;
  if (checkedAt && Date.now() - checkedAt.getTime() < MANUAL_REFRESH_GAP_MS) {
    sendError(res, 409, 'Сведения получены меньше 10 минут назад — обновлять чаще незачем', 'focus_fresh');
    return;
  }
  const result = await refreshFocusTarget(target, actorOf(req), {
    store: pgFocusStore,
    key: focusApiKey(),
    dailyLimit: env.FOCUS_DAILY_LIMIT,
    refreshDays: env.FOCUS_REFRESH_DAYS,
  });
  if (result.status === 'stopped') {
    const { status, error } = STOP_ERRORS[result.reason];
    sendError(res, status, error, `focus_${result.reason}`);
    return;
  }
  if (result.status === 'failed') {
    sendError(res, 502, `Контур.Фокус не ответил: ${result.error}`, 'focus_failed');
    return;
  }
  if (result.status === 'found') await syncFocusIdentity(getPool(), target);
  res.json({ outcome: result.status, saved: result.saved, view: await loadCompanyFocus(getPool(), id) });
});

focusRouter.get('/admin/focus', async (_req, res) => {
  const key = await loadStoredFocusKey();
  const [usedLastDay, coverage, recent] = await Promise.all([
    pgFocusStore.usedLastDay(),
    focusCoverage(getPool()),
    query(
      `SELECT requested_at AS "requestedAt", method, identifiers_count AS "identifiersCount", http_status AS "httpStatus",
              outcome, error, actor
       FROM focus_requests ORDER BY requested_at DESC, id DESC LIMIT $1`,
      [RECENT_REQUESTS],
    ),
  ]);
  res.json({
    key,
    enabled: env.FOCUS_ENABLED,
    dailyLimit: env.FOCUS_DAILY_LIMIT,
    refreshDays: env.FOCUS_REFRESH_DAYS,
    usedLastDay,
    coverage,
    recent,
  });
});

const SAVE_ERRORS = {
  invalid_key: { status: 400, error: 'Ключ — одна строка без пробелов, как его выдал Контур' },
  no_db_password: { status: 409, error: 'В DATABASE_URL нет пароля — ключ в базе нечем зашифровать. Задайте FOCUS_API_KEY в .env' },
  store_missing: { status: 503, error: 'Хранилища ключей нет — примените миграцию 032' },
  unknown_name: { status: 503, error: 'Хранилище ключей не знает ключ Фокуса — примените миграцию 040' },
} as const;

focusRouter.put('/admin/focus/key', async (req, res) => {
  const parsed = keySchema.safeParse(req.body);
  const key = parsed.success ? normalizeFocusKey(parsed.data.key) : null;
  if (key === null) {
    sendError(res, SAVE_ERRORS.invalid_key.status, SAVE_ERRORS.invalid_key.error, 'invalid_key');
    return;
  }
  // Проверка до записи: опечатку лучше увидеть сразу. Фокус не ответил — ключ всё равно сохраняется.
  const check = await checkFocusKey(key);
  await pgFocusStore
    .journal({
      method: 'stat',
      identifiersCount: 0,
      httpStatus: check.httpStatus,
      outcome: check.failure === null ? 'ok' : check.failure === 'forbidden' ? 'key_rejected' : check.failure,
      error: check.error,
      actor: actorOf(req),
    })
    .catch((err: unknown) => {
      // Без миграции 040 журнала нет; сохранение ниже скажет это словами (unknown_name), а не 500.
      if ((err as { code?: string }).code !== '42P01') throw err;
    });
  if (check.verdict === 'rejected') {
    sendError(res, 422, 'Контур.Фокус не принял ключ — он не сохранён', 'key_rejected');
    return;
  }
  const saved = await saveFocusKey(key, actorOf(req));
  if (!saved.ok) {
    const { status, error } = SAVE_ERRORS[saved.code];
    sendError(res, status, error, saved.code);
    return;
  }
  res.json({ key: saved.status, check: { verdict: check.verdict, error: check.error } });
});

focusRouter.delete('/admin/focus/key', async (req, res) => {
  res.json({ key: await clearFocusKey(actorOf(req)) });
});
