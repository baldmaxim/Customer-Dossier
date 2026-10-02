// Компании, которые заводит оператор (ADR-016, этап 23A): по ИНН/ОГРН и «На контроле».
//
// Права — auth/routePolicy.ts: всё здесь — companies.manage (оператор и администратор). Заведение
// компании сразу спрашивает Контур.Фокус (два запроса тарифа), если ключ задан и лимит позволяет:
// без наименования ЕГРЮЛ новая карточка — это только «ИНН …».

import type { Request } from 'express';
import { z } from 'zod';

import { actorOfContext, LOCAL_CONTEXT } from '../auth/service.js';
import { registerCompany } from '../companies/register.js';
import { loadCompanyWatch, unwatchCompany, watchCompany } from '../companies/watch.js';
import { env } from '../config/env.js';
import { getPool, queryOne, withTransaction } from '../db/pool.js';
import type { IFocusIdentifier } from '../focus/client.js';
import { syncFocusIdentity } from '../focus/identity.js';
import { refreshFocusTarget, type FocusStopReason } from '../focus/refresh.js';
import { pgFocusStore } from '../focus/store.js';
import { focusApiKey } from '../settings/focusKey.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const companyManageRouter = asyncRouter();

const actorOf = (req: Request): string => actorOfContext(req.auth ?? LOCAL_CONTEXT).login;

const registerSchema = z.object({ identifier: z.string().trim().min(10).max(20) }).strict();

const parseId = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(id) && id > 0 ? id : null;
};

/** Что ответил Фокус при заведении: экран говорит это словами, заведение от ответа не зависит. */
export type RegisterFocusOutcome =
  | { status: 'found' | 'not_found' }
  | { status: 'already_checked' }
  | { status: 'stopped'; reason: FocusStopReason }
  | { status: 'failed'; error: string };

const askFocus = async (target: IFocusIdentifier, actor: string): Promise<RegisterFocusOutcome> => {
  const checked = await queryOne<{ outcome: string | null }>(
    'SELECT outcome FROM focus_checks WHERE identifier_type = $1 AND identifier = $2 AND outcome IS NOT NULL',
    [target.type, target.value],
  );
  // Уже спрашивали — ответ лежит снимком: второй раз за деньги тарифа незачем, имя применяется из него.
  if (checked) {
    await syncFocusIdentity(getPool(), target);
    return { status: 'already_checked' };
  }
  const result = await refreshFocusTarget(target, actor, {
    store: pgFocusStore,
    key: focusApiKey(),
    dailyLimit: env.FOCUS_DAILY_LIMIT,
    refreshDays: env.FOCUS_REFRESH_DAYS,
  });
  if (result.status === 'stopped') return { status: 'stopped', reason: result.reason };
  if (result.status === 'failed') return { status: 'failed', error: result.error };
  if (result.status === 'found') await syncFocusIdentity(getPool(), target);
  return { status: result.status };
};

companyManageRouter.post('/', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Укажите ИНН (10 или 12 цифр), ОГРН (13) или ОГРНИП (15)', code: 'bad_format' });
    return;
  }
  const actor = actorOf(req);
  const result = await withTransaction(client => registerCompany(client, { raw: parsed.data.identifier, actor }));
  if (!result.ok) {
    res.status(422).json(
      result.reason === 'bad_checksum'
        ? { error: 'Контрольная сумма не сходится — проверьте цифры реквизита', code: 'bad_checksum' }
        : { error: 'Укажите ИНН (10 или 12 цифр), ОГРН (13) или ОГРНИП (15)', code: 'bad_format' },
    );
    return;
  }
  const focus = await askFocus(result.focusTarget, actor);
  res.status(result.created ? 201 : 200).json({
    companyId: result.companyId,
    created: result.created,
    identifier: { type: result.identifier.identifierType, value: result.identifier.value },
    focus,
  });
});

const liveCompany = async (id: number): Promise<boolean> =>
  (await queryOne<{ id: number }>('SELECT id FROM companies WHERE id = $1 AND merged_into_id IS NULL', [id])) !== null;

companyManageRouter.put('/:id/watch', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null || !(await liveCompany(id))) {
    res.status(404).json({ error: 'Компания не найдена', code: 'not_found' });
    return;
  }
  await watchCompany(getPool(), id, actorOf(req));
  res.json({ watch: await loadCompanyWatch(getPool(), id) });
});

companyManageRouter.delete('/:id/watch', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null || !(await liveCompany(id))) {
    res.status(404).json({ error: 'Компания не найдена', code: 'not_found' });
    return;
  }
  await unwatchCompany(getPool(), id, actorOf(req));
  res.json({ watch: null });
});
