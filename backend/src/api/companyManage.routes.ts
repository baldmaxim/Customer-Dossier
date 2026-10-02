// Компании от оператора (ADR-016): заведение по ИНН/ОГРН и «На контроле» (этап 23A), назначение имени
// без ИНН — «это юрлицо с ИНН …», поиск юрлица по названию, «не компания» (этап 23D). «Это компания X» —
// слияние существующим путём /api/entities/merge* (предпросмотр и токен), здесь его нет.
//
// Права — auth/routePolicy.ts: изменения здесь — companies.manage (оператор и администратор), чтение
// назначения — portal.read. Заведение компании и назначение реквизита сразу спрашивают Контур.Фокус (два
// запроса тарифа), если ключ задан и лимит позволяет: без наименования ЕГРЮЛ карточка — это только «ИНН …».

import type { Request } from 'express';
import { z } from 'zod';

import { actorOfContext, LOCAL_CONTEXT } from '../auth/service.js';
import { dismissCompany, identifyCompany, loadAssignment, restoreCompany } from '../companies/assignment.js';
import { focusTargetOf, registerCompany } from '../companies/register.js';
import { loadCompanyWatch, unwatchCompany, watchCompany } from '../companies/watch.js';
import { env } from '../config/env.js';
import { getPool, queryOne, withTransaction } from '../db/pool.js';
import type { IFocusIdentifier } from '../focus/client.js';
import { syncFocusIdentity } from '../focus/identity.js';
import { refreshFocusTarget, type FocusStopReason } from '../focus/refresh.js';
import { searchCompanyName } from '../focus/suggest.js';
import { pgFocusStore } from '../focus/store.js';
import { focusApiKey } from '../settings/focusKey.js';
import { asyncRouter } from '../utils/asyncRouter.js';
import { STOP_ERRORS } from './focus.routes.js';

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

// --- Назначение имени без ИНН (этап 23D) ------------------------------------------------------------

companyManageRouter.get('/:id/assignment', async (req, res) => {
  const id = parseId(req.params.id);
  const view = id === null ? null : await loadAssignment(getPool(), id);
  if (!view) {
    res.status(404).json({ error: 'Компания не найдена', code: 'not_found' });
    return;
  }
  res.json({ ...view, focusConfigured: focusApiKey() !== null });
});

const identifySchema = z.object({ identifier: z.string().trim().min(10).max(20) }).strict();

companyManageRouter.post('/:id/identify', async (req, res) => {
  const id = parseId(req.params.id);
  const parsed = identifySchema.safeParse(req.body);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Укажите ИНН (10 или 12 цифр), ОГРН (13) или ОГРНИП (15)', code: 'bad_format' });
    return;
  }
  const actor = actorOf(req);
  const result = await withTransaction(client => identifyCompany(client, { companyId: id, raw: parsed.data.identifier, actor }));
  if (!result.ok) {
    if (result.reason === 'identifier_taken') {
      res.status(409).json({
        error: `Этот реквизит уже у компании «${result.companyName}» — назначьте имя ей`,
        code: 'identifier_taken',
        companyId: result.companyId,
        companyName: result.companyName,
      });
    } else if (result.reason === 'identifier_conflict') {
      res.status(409).json({ error: 'У карточки уже есть другой реквизит этого типа', code: 'identifier_conflict' });
    } else if (result.reason === 'not_found') {
      res.status(404).json({ error: 'Компания не найдена', code: 'not_found' });
    } else {
      res.status(422).json(
        result.reason === 'bad_checksum'
          ? { error: 'Контрольная сумма не сходится — проверьте цифры реквизита', code: 'bad_checksum' }
          : { error: 'Укажите ИНН (10 или 12 цифр), ОГРН (13) или ОГРНИП (15)', code: 'bad_format' },
      );
    }
    return;
  }
  const focus = await askFocus(focusTargetOf(result.identifier), actor);
  res.json({ identifier: { type: result.identifier.identifierType, value: result.identifier.value }, focus });
});

/** Кнопкой — не чаще раза в 10 минут на имя: двойное нажатие не должно стоить двух запросов. */
const NAME_SEARCH_GAP_MS = 10 * 60_000;

companyManageRouter.post('/:id/name-search', async (req, res) => {
  const id = parseId(req.params.id);
  const company = id === null ? null : await queryOne<{ id: number; name: string; searched_at: Date | null }>(
    `SELECT c.id, c.name, s.searched_at FROM companies c LEFT JOIN company_name_searches s ON s.company_id = c.id
     WHERE c.id = $1 AND c.merged_into_id IS NULL`,
    [id],
  );
  if (!company) {
    res.status(404).json({ error: 'Компания не найдена', code: 'not_found' });
    return;
  }
  if (company.searched_at && Date.now() - company.searched_at.getTime() < NAME_SEARCH_GAP_MS) {
    res.status(409).json({ error: 'Искали меньше 10 минут назад — подсказки уже на экране', code: 'name_search_fresh' });
    return;
  }
  const result = await searchCompanyName(getPool(), company, actorOf(req), {
    store: pgFocusStore,
    key: focusApiKey(),
    dailyLimit: env.FOCUS_DAILY_LIMIT,
  });
  if (result.status === 'stopped') {
    const { status, error } = STOP_ERRORS[result.reason];
    res.status(status).json({ error, code: `focus_${result.reason}` });
    return;
  }
  if (result.status === 'failed') {
    res.status(502).json({ error: `Контур.Фокус не ответил: ${result.error}`, code: 'focus_failed' });
    return;
  }
  res.json({ result, view: await loadAssignment(getPool(), company.id) });
});

const dismissSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

companyManageRouter.put('/:id/dismissal', async (req, res) => {
  const id = parseId(req.params.id);
  const parsed = dismissSchema.safeParse(req.body);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Напишите, почему это не компания', code: 'reason_required' });
    return;
  }
  if (!(await liveCompany(id))) {
    res.status(404).json({ error: 'Компания не найдена', code: 'not_found' });
    return;
  }
  await dismissCompany(getPool(), id, parsed.data.reason, actorOf(req));
  res.json({ view: await loadAssignment(getPool(), id) });
});

companyManageRouter.delete('/:id/dismissal', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null || !(await liveCompany(id))) {
    res.status(404).json({ error: 'Компания не найдена', code: 'not_found' });
    return;
  }
  await restoreCompany(getPool(), id, actorOf(req));
  res.json({ view: await loadAssignment(getPool(), id) });
});
