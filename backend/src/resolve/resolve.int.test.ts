// R01, R02 на настоящей базе: быстрые пути резолвера не склеивают одноимённые
// юрлица с разными реквизитами и объекты с неизвестной или разной географией.
// Все названия и реквизиты — синтетические (контрольные суммы валидны).

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool, withTransaction } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { resolveCompany } from './company.js';
import { resolveProject } from './project.js';

beforeAll(async () => {
  await resetAndMigrate();
});

afterAll(async () => {
  await closeDb();
});

const company = (surface: string, taxId: string | null = null, legalForm: string | null = null) =>
  withTransaction(client => resolveCompany(client, { surface, taxId, legalForm, city: null, documentId: null }));

const project = (surface: string, city: string | null) =>
  withTransaction(client => resolveProject(client, { surface, city, kind: 'residential', stage: 'unknown' }));

describe('resolveCompany — точные совпадения (R01)', () => {
  const ids: number[] = [];

  it('одинаковое имя и разные известные ИНН — разные юрлица, пара запрещена', async () => {
    const first = await company('Синтезстрой Альфа', '7707083893', 'ООО');
    const second = await company('Синтезстрой Альфа', '7736050003', 'ООО');

    expect(first?.method).toBe('created');
    expect(second?.companyId).not.toBe(first?.companyId);
    ids.push(first!.companyId, second!.companyId);

    const queue = await getPool().query<{ status: string }>(
      `SELECT status FROM merge_queue
       WHERE least(source_entity_id, target_entity_id) = least($1::bigint, $2::bigint)
         AND greatest(source_entity_id, target_entity_id) = greatest($1::bigint, $2::bigint)`,
      [first!.companyId, second!.companyId],
    );
    expect(queue.rows[0]?.status).toBe('rejected');
  });

  it('новое упоминание без реквизитов при двух одноимённых кандидатах не выбирает первого', async () => {
    const third = await company('Синтезстрой Альфа');
    expect(ids).not.toContain(third?.companyId);
    expect(third?.method === 'created' || third?.method === 'created_queued').toBe(true);
  });

  it('ИНН и ОГРН одной компании не считаются конфликтом', async () => {
    // У «Синтезстрой Альфа» с ИНН 7707083893 появляется упоминание с ОГРН.
    // Это не повод навсегда запрещать пару, но и не повод сливать вслепую.
    const withOgrn = await company('Синтезстрой Альфа Холдинг', '1027700132239', 'ООО');
    const forbidden = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM merge_queue
       WHERE status = 'rejected' AND (source_entity_id = $1 OR target_entity_id = $1)
         AND reasons->>'tax_id' = 'conflict'`,
      [withOgrn!.companyId],
    );
    expect(forbidden.rows[0]?.n).toBe(0);
  });

  it('единственный совместимый кандидат находится быстрым путём', async () => {
    const a = await company('Синтезмонтаж Бета', null, 'АО');
    const b = await company('Синтезмонтаж Бета', null, 'АО');
    expect(a?.method).toBe('created');
    expect(b?.method).toBe('alias');
    expect(b?.companyId).toBe(a?.companyId);
  });

  it('конфликт организационной формы блокирует быстрый путь', async () => {
    const a = await company('Синтезпроект Гамма', null, 'ООО');
    const b = await company('Синтезпроект Гамма', null, 'АО');
    expect(b?.companyId).not.toBe(a?.companyId);
  });
});

describe('resolveProject — география (R02)', () => {
  it('одинаковые ЖК в двух городах — разные объекты', async () => {
    const moscow = await project('ЖК Синтетический Парк', 'Москва');
    const kazan = await project('ЖК Синтетический Парк', 'Казань');
    expect(kazan?.projectId).not.toBe(moscow?.projectId);
  });

  it('неизвестный город не склеивается с объектом, у которого город известен', async () => {
    const unknown = await project('ЖК Синтетический Парк', null);
    const existing = await getPool().query<{ id: number }>(
      `SELECT id FROM projects WHERE name ILIKE '%Синтетический Парк%' AND city IS NOT NULL`,
    );
    expect(existing.rows.map(r => r.id)).not.toContain(unknown?.projectId);
  });

  it('тот же город находит тот же объект', async () => {
    const again = await project('ЖК Синтетический Парк', 'москва');
    const moscow = await getPool().query<{ id: number }>(
      `SELECT id FROM projects WHERE city = 'Москва' AND name ILIKE '%Синтетический Парк%'`,
    );
    expect(again?.projectId).toBe(moscow.rows[0]?.id);
  });
});
