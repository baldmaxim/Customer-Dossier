// Контур.Фокус на настоящей базе (миграция 040, ADR-015): очередь — заказчики первыми, по одному
// реквизиту; снимок пишется только при изменившемся ответе; изменения видны на чтении; сбой отодвигает
// повтор; ключ Фокуса хранится рядом с ключом OpenRouter. Сети нет: вызов API подменён.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { clearFocusKey, focusApiKey, loadStoredFocusKey, saveFocusKey } from '../settings/focusKey.js';
import type { callFocus, FocusCallResult, FocusMethod } from './client.js';
import { loadCompanyFocus } from './read.js';
import { refreshFocusTarget } from './refresh.js';
import { pgFocusStore } from './store.js';
import { dueFocusTargets, focusCoverage } from './targets.js';

const INN_A = '7700001235';
const INN_B = '7700001236';
const pool = getPool;

const company = async (name: string): Promise<number> =>
  (await pool().query<{ id: number }>(`INSERT INTO companies (name, name_norm, name_latin) VALUES ($1, lower($1), lower($1)) RETURNING id`, [name])).rows[0]!.id;

const identifier = async (companyId: number, type: string, value: string): Promise<void> => {
  await pool().query(
    `INSERT INTO entity_identifiers (company_id, jurisdiction, identifier_type, value, validation_status, origin)
     VALUES ($1, 'RU', $2, $3, 'checksum_valid', 'manual')`,
    [companyId, type, value],
  );
};

const customerOf = async (companyId: number, project: string): Promise<void> => {
  const projectId = (
    await pool().query<{ id: number }>(`INSERT INTO projects (name, name_norm, name_latin) VALUES ($1, lower($1), lower($1)) RETURNING id`, [project])
  ).rows[0]!.id;
  await pool().query(`INSERT INTO project_participants (project_id, company_id, role) VALUES ($1, $2, 'customer')`, [projectId, companyId]);
};

const answer = (inn: string, head: string): Record<FocusMethod, FocusCallResult> => ({
  req: {
    ok: true,
    httpStatus: 200,
    items: [{ inn, ogrn: null, payload: { inn, UL: { legalName: { short: 'ООО "ДЕМО"' }, status: { statusString: 'Действующее' }, heads: [{ fio: head, position: 'Директор' }] } } }],
  },
  egrDetails: {
    ok: true,
    httpStatus: 200,
    items: [{ inn, ogrn: null, payload: { inn, UL: { activities: { principalActivity: { code: '41.20', text: 'Строительство' } } } } }],
  },
});

const scripted = (answers: Record<FocusMethod, FocusCallResult>): typeof callFocus => async method => answers[method];

const deps = (call: typeof callFocus) => ({ store: pgFocusStore, key: 'demo-focus-key-0001', dailyLimit: 100, refreshDays: 14, call });

let alpha = 0;
let beta = 0;
let several = 0;
let bare = 0;

beforeAll(async () => {
  await resetAndMigrate();
  beta = await company('Демо-Бета Подряд');
  alpha = await company('Демо-Альфа Заказчик');
  several = await company('Демо-Два ИНН');
  bare = await company('Демо-Без реквизитов');
  await customerOf(alpha, 'Демо-квартал');
  await identifier(alpha, 'inn', INN_A);
  await identifier(beta, 'inn', INN_B);
  await identifier(several, 'inn', '7700001237');
  await identifier(several, 'inn', '7700001238');
});

afterAll(async () => {
  await closeDb();
});

describe('Контур.Фокус на базе', () => {
  it('очередь: один реквизит на компанию, заказчик первым; два ИНН и без реквизитов не спрашиваются', async () => {
    expect(await dueFocusTargets(pool(), 10)).toEqual([
      { type: 'inn', value: INN_A },
      { type: 'inn', value: INN_B },
    ]);
    expect(await focusCoverage(pool())).toEqual({ companies: 2, identifiers: 2, found: 0, notFound: 0, due: 2, failing: 0 });
    expect(await loadCompanyFocus(pool(), several)).toMatchObject({ problem: 'several_identifiers', identifier: null, fields: [] });
    expect(await loadCompanyFocus(pool(), bare)).toMatchObject({ problem: 'no_identifier' });
  });

  it('обновление пишет два снимка и журнал; тот же ответ снимков не добавляет, но продлевает срок', async () => {
    const target = { type: 'inn' as const, value: INN_A };
    expect(await refreshFocusTarget(target, 'alpha', deps(scripted(answer(INN_A, 'Иванов И. И.'))))).toMatchObject({ status: 'found', saved: 2 });
    expect(await refreshFocusTarget(target, 'alpha', deps(scripted(answer(INN_A, 'Иванов И. И.'))))).toMatchObject({ status: 'found', saved: 0 });
    expect((await pool().query('SELECT 1 FROM focus_records')).rowCount).toBe(2);
    expect(await pgFocusStore.usedLastDay()).toBe(4);
    expect(await dueFocusTargets(pool(), 10)).toEqual([{ type: 'inn', value: INN_B }]);

    const view = await loadCompanyFocus(pool(), alpha);
    expect(view).toMatchObject({
      identifier: target,
      problem: null,
      check: { outcome: 'found', attemptCount: 0, lastError: null },
      summary: { status: 'Действующее', head: 'Иванов И. И. — Директор' },
      changes: [],
    });
    expect(view.fields.map(f => f.key)).toEqual(['name', 'status', 'heads', 'activity']);
  });

  it('сменился руководитель — новый снимок req, на карточке «было — стало»', async () => {
    const target = { type: 'inn' as const, value: INN_A };
    expect(await refreshFocusTarget(target, 'alpha', deps(scripted(answer(INN_A, 'Петров П. П.'))))).toMatchObject({ status: 'found', saved: 1 });
    const view = await loadCompanyFocus(pool(), alpha);
    expect(view.summary?.head).toBe('Петров П. П. — Директор');
    expect(view.changes).toHaveLength(1);
    expect(view.changes[0]!.changes).toEqual([{ label: 'Руководитель', from: 'Иванов И. И. — Директор', to: 'Петров П. П. — Директор' }]);
  });

  it('сбой Фокуса — повтор отодвигается, прежние сведения на месте; успех сбрасывает счётчик', async () => {
    const target = { type: 'inn' as const, value: INN_B };
    const broken: Record<FocusMethod, FocusCallResult> = {
      req: { ok: false, failure: 'http_error', httpStatus: 500, error: 'oops' },
      egrDetails: { ok: false, failure: 'http_error', httpStatus: 500, error: 'oops' },
    };
    await refreshFocusTarget(target, 'scheduler', deps(scripted(broken)));
    await refreshFocusTarget(target, 'scheduler', deps(scripted(broken)));
    const row = (
      await pool().query<{ attempt_count: number; last_error: string; hours: number }>(
        `SELECT attempt_count, last_error, round(extract(epoch FROM next_check_at - now()) / 3600)::int AS hours FROM focus_checks WHERE identifier = $1`,
        [INN_B],
      )
    ).rows[0];
    expect(row).toEqual({ attempt_count: 2, last_error: 'req: oops', hours: 2 });
    expect(await focusCoverage(pool())).toMatchObject({ found: 1, failing: 1, due: 0 });
    // Неудачи тариф не тратят.
    expect(await pgFocusStore.usedLastDay()).toBe(6);

    await refreshFocusTarget(target, 'scheduler', deps(scripted({ req: { ok: true, httpStatus: 200, items: [] }, egrDetails: broken.egrDetails })));
    expect(await loadCompanyFocus(pool(), beta)).toMatchObject({ check: { outcome: 'not_found', attemptCount: 0, lastError: null }, fields: [] });
  });

  it('метод вне списка (скоринг, экспресс-отчёт) база не примет', async () => {
    await expect(
      pool().query(`INSERT INTO focus_records (identifier_type, identifier, method, payload, payload_hash) VALUES ('inn', $1, 'scoring', '{}', $2)`, [
        INN_A,
        'a'.repeat(64),
      ]),
    ).rejects.toThrow(/focus_records_method/);
  });

  it('ключ Фокуса — шифротекстом в app_secrets рядом с ключом OpenRouter; удаление возвращает .env', async () => {
    expect(await saveFocusKey(' demo-focus-key-7731 ', 'alpha')).toMatchObject({ ok: true, status: { source: 'admin', hint: '7731' } });
    const row = (await pool().query<{ ciphertext: string }>(`SELECT ciphertext FROM app_secrets WHERE name = 'kontur_focus_api_key'`)).rows[0];
    expect(row?.ciphertext).not.toContain('demo-focus-key-7731');
    expect(await loadStoredFocusKey()).toMatchObject({ source: 'admin', problem: null });
    expect(focusApiKey()).toBe('demo-focus-key-7731');
    expect(await clearFocusKey('alpha')).toMatchObject({ source: 'none' });
    expect(focusApiKey()).toBeNull();
  });
});
