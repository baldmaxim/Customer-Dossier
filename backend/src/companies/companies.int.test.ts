// Компания по реквизиту и «На контроле» на настоящей базе (миграция 042, ADR-016, этап 23A).
// Заведение по ИНН создаёт юрлицо с временным именем и отметкой; повтор и чужая карточка с тем же ИНН
// дубля не дают. Наименование ЕГРЮЛ из снимка Фокуса заменяет временное имя и становится написанием,
// имя из публикаций не перетирает. Отметка снимается без удаления, слияние переносит её к цели.
// Данные синтетические, сети нет: снимок Фокуса пишется прямо в focus_records.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool, withTransaction } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { syncFocusIdentity } from '../focus/identity.js';
import { pgFocusStore } from '../focus/store.js';
import { dueFocusTargets } from '../focus/targets.js';
import { applyEntityMerge } from '../resolve/entityMerge.js';
import { registerCompany } from './register.js';
import { loadCompanyWatch, unwatchCompany, watchCompany } from './watch.js';

const INN_NEW = '7707083893';
const INN_TEXT = '7700001235';
const pool = getPool;

const register = (raw: string) => withTransaction(client => registerCompany(client, { raw, actor: 'oper' }));

const reqSnapshot = async (inn: string, short: string, full: string): Promise<void> => {
  await pgFocusStore.saveRecord({ type: 'inn', value: inn }, 'req', {
    inn,
    ogrn: null,
    payload: { inn, UL: { legalName: { short, full }, status: { statusString: 'Действующее' } } },
  });
};

const companyRow = async (id: number) =>
  (await pool().query<{ name: string; name_pending: boolean; entity_type: string; legal_form: string | null }>(
    'SELECT name, name_pending, entity_type, legal_form FROM companies WHERE id = $1', [id],
  )).rows[0]!;

let fromText = 0;

beforeAll(async () => {
  await resetAndMigrate();
  fromText = (await pool().query<{ id: number }>(
    `INSERT INTO companies (name, name_norm, name_latin, entity_type) VALUES ('Демо-Текст', 'демо текст', 'demo tekst', 'legal_entity') RETURNING id`,
  )).rows[0]!.id;
  await pool().query(
    `INSERT INTO entity_identifiers (company_id, jurisdiction, identifier_type, value, validation_status, origin)
     VALUES ($1, 'RU', 'inn', $2, 'checksum_valid', 'extraction')`,
    [fromText, INN_TEXT],
  );
});

afterAll(async () => {
  await closeDb();
});

describe('компания по реквизиту', () => {
  it('новый ИНН: юрлицо с временным именем, реквизитом от оператора и отметкой «на контроле»', async () => {
    const result = await register(INN_NEW);
    expect(result).toMatchObject({ ok: true, created: true, focusTarget: { type: 'inn', value: INN_NEW } });
    if (!result.ok) return;
    expect(await companyRow(result.companyId)).toMatchObject({ name: `ИНН ${INN_NEW}`, name_pending: true, entity_type: 'legal_entity' });
    const ids = (await pool().query('SELECT identifier_type, value, origin, created_by FROM entity_identifiers WHERE company_id = $1', [result.companyId])).rows;
    expect(ids).toEqual([{ identifier_type: 'inn', value: INN_NEW, origin: 'manual', created_by: 'oper' }]);
    expect(await loadCompanyWatch(pool(), result.companyId)).toMatchObject({ addedBy: 'oper' });

    // Повтор — та же карточка, вторая отметка не появляется.
    const again = await register(` ${INN_NEW} `);
    expect(again).toMatchObject({ ok: true, created: false, companyId: result.companyId });
    expect((await pool().query('SELECT 1 FROM company_watch WHERE company_id = $1', [result.companyId])).rowCount).toBe(1);
  });

  it('ИНН уже у карточки из публикаций — она и возвращается, дубля нет', async () => {
    const result = await register(INN_TEXT);
    expect(result).toMatchObject({ ok: true, created: false, companyId: fromText });
    expect((await pool().query("SELECT count(*)::int AS n FROM entity_identifiers WHERE value = $1 AND status = 'active'", [INN_TEXT])).rows[0]).toEqual({ n: 1 });
  });

  it('опечатка в ИНН — отказ, компании нет', async () => {
    const before = (await pool().query<{ n: number }>('SELECT count(*)::int AS n FROM companies')).rows[0]!.n;
    expect(await register('7707083894')).toEqual({ ok: false, reason: 'bad_checksum' });
    expect((await pool().query<{ n: number }>('SELECT count(*)::int AS n FROM companies')).rows[0]!.n).toBe(before);
  });

  it('наименование ЕГРЮЛ заменяет временное имя один раз и становится написанием; имя из текста не трогается', async () => {
    const created = await register(INN_NEW);
    if (!created.ok) throw new Error('компания не заведена');
    await reqSnapshot(INN_NEW, 'ООО "СЗ "ДЕМО-НОВАЯ"', 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "СЗ "ДЕМО-НОВАЯ"');
    const first = await syncFocusIdentity(pool(), { type: 'inn', value: INN_NEW });
    // Полное наименование после среза формы совпало с кратким — одно написание, а не два.
    expect(first).toEqual({ companies: 1, aliasesAdded: 1, renamed: 1 });
    expect(await companyRow(created.companyId)).toMatchObject({ name: 'СЗ ДЕМО-НОВАЯ', name_pending: false, legal_form: 'ООО' });
    const aliases = (await pool().query("SELECT alias, source, hits FROM entity_aliases WHERE entity_id = $1 AND entity_kind = 'company' ORDER BY id", [created.companyId])).rows;
    expect(aliases).toEqual([{ alias: 'ООО "СЗ "ДЕМО-НОВАЯ"', source: 'focus', hits: 1 }]);

    // Повтор ничего не меняет: ни имени, ни счётчика написаний.
    expect(await syncFocusIdentity(pool(), { type: 'inn', value: INN_NEW })).toEqual({ companies: 1, aliasesAdded: 0, renamed: 0 });

    await reqSnapshot(INN_TEXT, 'ООО "ДЕМО-ЕГРЮЛ"', 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ДЕМО-ЕГРЮЛ"');
    const text = await syncFocusIdentity(pool(), { type: 'inn', value: INN_TEXT });
    expect(text.renamed).toBe(0);
    expect((await companyRow(fromText)).name).toBe('Демо-Текст');
  });

  it('компания «на контроле» — первой в очереди Фокуса', async () => {
    await pool().query('DELETE FROM focus_checks');
    const created = await register(INN_NEW);
    if (!created.ok) throw new Error('компания не заведена');
    await unwatchCompany(pool(), created.companyId, 'oper');
    await watchCompany(pool(), fromText, 'oper');
    expect((await dueFocusTargets(pool(), 1))[0]).toEqual({ type: 'inn', value: INN_TEXT });
  });

  it('снятие — отметкой, без удаления; слияние переносит отметку, вторая действующая у цели не появляется', async () => {
    const created = await register(INN_NEW);
    if (!created.ok) throw new Error('компания не заведена');
    await watchCompany(pool(), created.companyId, 'oper');
    const history = (await pool().query('SELECT removed_by FROM company_watch WHERE company_id = $1 ORDER BY id', [created.companyId])).rows;
    expect(history).toEqual([{ removed_by: 'oper' }, { removed_by: null }]);

    // Обе стороны «на контроле»: у цели остаётся одна действующая отметка, снятая — переносится историей.
    const dup = (await pool().query<{ id: number }>(
      `INSERT INTO companies (name, name_norm, name_latin) VALUES ('Демо-Новая дубль', 'демо новая дубль', 'demo novaya dubl') RETURNING id`,
    )).rows[0]!.id;
    await watchCompany(pool(), dup, 'oper');
    const versions = (await pool().query<{ id: number; version: number }>('SELECT id, version FROM companies WHERE id = ANY($1::bigint[])', [[dup, created.companyId]])).rows;
    await applyEntityMerge({
      kind: 'company',
      sourceId: dup,
      targetId: created.companyId,
      expectedSourceVersion: versions.find(v => v.id === dup)!.version,
      expectedTargetVersion: versions.find(v => v.id === created.companyId)!.version,
      idempotencyKey: 'company-watch-merge-0001',
      actor: 'int-test',
    });
    const watches = (await pool().query('SELECT company_id, removed_at IS NULL AS active FROM company_watch WHERE company_id = ANY($1::bigint[]) ORDER BY id', [[dup, created.companyId]])).rows;
    expect(watches.filter(w => w.active)).toEqual([{ company_id: created.companyId, active: true }]);
    expect(watches.every(w => w.company_id === created.companyId)).toBe(true);
  });
});
