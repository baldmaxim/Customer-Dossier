// Вкладка админки «Модель»: где идёт разбор и ключ OpenRouter. Чтение — admin.view, ключ — llm.manage
// (auth/routePolicy.ts). Ключ в ответ не попадает никогда: только источник, четыре последних символа,
// кто и когда задал. Провайдер, модель и маршрут — из .env: переключение на облако остаётся решением
// владельца (тексты публикаций уходят внешнему сервису), а не кнопкой.

import type { Request, Response } from 'express';
import { z } from 'zod';

import { actorOfContext, LOCAL_CONTEXT } from '../auth/service.js';
import { env } from '../config/env.js';
import { OPENROUTER_BASE_URL } from '../config/llm.js';
import { checkLlmConnection } from '../llm/client.js';
import { checkOpenRouterKey } from '../llm/endpoint.js';
import { clearLlmKey, loadStoredLlmKey, normalizeLlmKey, saveLlmKey } from '../settings/llmKey.js';
import { asyncRouter } from '../utils/asyncRouter.js';

const keySchema = z.object({ key: z.string().max(1024) }).strict();

const actorOf = (req: Request): string => actorOfContext(req.auth ?? LOCAL_CONTEXT).login;

/** Проверки на экране — короткие: страница не должна висеть на недоступном OpenRouter. */
const CHECK_TIMEOUT_MS = 5000;

const SAVE_ERRORS = {
  invalid_key: { status: 400, error: 'Ключ — одна строка без пробелов, как её выдал OpenRouter' },
  no_db_password: {
    status: 409,
    error: 'В DATABASE_URL нет пароля — ключ в базе нечем зашифровать. Задайте LLM_API_KEY в .env',
  },
  store_missing: { status: 503, error: 'Хранилища ключей нет — примените миграцию 032' },
} as const;

const sendSaveError = (res: Response, code: keyof typeof SAVE_ERRORS): void => {
  const { status, error } = SAVE_ERRORS[code];
  res.status(status).json({ error, code });
};

export const llmRouter = asyncRouter();

llmRouter.get('/llm', async (_req, res) => {
  const key = await loadStoredLlmKey();
  const connection = await checkLlmConnection(CHECK_TIMEOUT_MS);
  res.json({
    provider: env.LLM_PROVIDER,
    model: env.LMSTUDIO_MODEL,
    routeProviders: env.OPENROUTER_PROVIDERS,
    key,
    connection: { ok: connection.ok, error: connection.error ?? null },
  });
});

llmRouter.put('/llm/key', async (req, res) => {
  const parsed = keySchema.safeParse(req.body);
  const key = parsed.success ? normalizeLlmKey(parsed.data.key) : null;
  if (key === null) {
    sendSaveError(res, 'invalid_key');
    return;
  }
  // Проверка до записи: опечатку лучше увидеть сразу, чем по остановившемуся разбору. OpenRouter
  // не ответил — ключ всё равно сохраняется: недоступность сети не повод терять введённое.
  const baseUrl = env.LLM_PROVIDER === 'openrouter' ? env.LMSTUDIO_BASE_URL : OPENROUTER_BASE_URL;
  const check = await checkOpenRouterKey(baseUrl, key, CHECK_TIMEOUT_MS);
  if (check.verdict === 'rejected') {
    res.status(422).json({ error: 'OpenRouter не принял ключ — он не сохранён', code: 'key_rejected' });
    return;
  }
  const saved = await saveLlmKey(key, actorOf(req));
  if (!saved.ok) {
    sendSaveError(res, saved.code);
    return;
  }
  res.json({ key: saved.status, check: { verdict: check.verdict, error: check.error ?? null } });
});

llmRouter.delete('/llm/key', async (req, res) => {
  res.json({ key: await clearLlmKey(actorOf(req)) });
});
