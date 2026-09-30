import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import { attachBrowserCaptureToProject, linkedRegistryProject } from './projectLink.js';

const client = (links: Array<{ project_id: number; merged_into_id: number | null }>, projectExists = true) => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT DISTINCT r.project_id')) return { rows: links };
    if (sql.includes('SELECT merged_into_id FROM projects')) return { rows: projectExists ? [{ merged_into_id: null }] : [] };
    return { rows: [] };
  });
  return { db: { query } as unknown as PoolClient, query };
};

describe('связь снимка ДОМ.РФ с объектом портала', () => {
  it('переиспользует существующую карточку по внешнему ID при изменении названия', async () => {
    const { db } = client([{ project_id: 42, merged_into_id: null }]);
    expect(await linkedRegistryProject(db, 14, '62087')).toBe(42);
  });

  it('не переносит снимок на другую карточку при конфликтующей ручной привязке', async () => {
    const { db, query } = client([{ project_id: 42, merged_into_id: null }]);
    await expect(attachBrowserCaptureToProject(db, 14, '62087', 2388)).rejects.toThrow('уже связан с карточкой #42');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE registry_records'))).toBe(false);
  });

  it('отвергает неизвестную карточку', async () => {
    const { db } = client([], false);
    await expect(linkedRegistryProject(db, 14, '62087', 999999)).rejects.toThrow('не найдена');
  });

  it('прикрепляет прежний снимок даже без новой редакции', async () => {
    const { db, query } = client([]);
    await attachBrowserCaptureToProject(db, 14, '62087', 42);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE registry_records'))).toBe(true);
  });
});
