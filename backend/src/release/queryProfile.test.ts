// Этап 18 без БД: нормализация текста запросов (значения не сохраняются) и признак N+1.

import { describe, expect, it } from 'vitest';

import { N_PLUS_ONE_THRESHOLD, normalizeSql, summarizeProfile, type IQueryStat } from './queryProfile.js';

describe('профиль запросов query-profile@1', () => {
  it('литералы, числа и комментарии не попадают в профиль; разные значения — один запрос', () => {
    const a = normalizeSql(`SELECT * FROM companies -- поиск\n WHERE name = 'Секрет-Демо' AND id = 42`);
    const b = normalizeSql(`SELECT *   FROM companies WHERE name = 'Другое' AND id = 7`);
    expect(a).toBe("SELECT * FROM companies WHERE name = '?' AND id = ?");
    expect(a).toBe(b);
    expect(a).not.toContain('Секрет');
    expect(normalizeSql('SELECT $1::bigint')).toBe('SELECT $?::bigint');
  });

  it('сводка на выборку: топ по времени, N+1 — повтор одного запроса больше порога на выборку', () => {
    const stats = new Map<string, IQueryStat>([
      ['q1', { sql: 'q1', calls: 5, totalMs: 50, maxMs: 20 }],
      ['q2', { sql: 'q2', calls: 5 * (N_PLUS_ONE_THRESHOLD + 5), totalMs: 30, maxMs: 1 }],
    ]);
    const s = summarizeProfile(stats, 5);
    expect(s.queriesPerSample).toBe(1 + N_PLUS_ONE_THRESHOLD + 5);
    expect(s.msPerSample).toBe(16);
    expect(s.top.map(q => q.sql)).toEqual(['q1', 'q2']);
    expect(s.suspectedNPlusOne).toEqual([{ sql: 'q2', callsPerSample: N_PLUS_ONE_THRESHOLD + 5 }]);
    expect(summarizeProfile(new Map(), 0)).toMatchObject({ queriesPerSample: 0, top: [], suspectedNPlusOne: [] });
  });
});
