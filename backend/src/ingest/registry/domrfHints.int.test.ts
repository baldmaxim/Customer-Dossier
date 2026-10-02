// Этап 20D, шаг 3 на настоящей базе (миграция 038): подсказка модели к совпадению с реестром ДОМ.РФ.
// Без ИИ-допуска источника наш.дом.рф модель не зовут вовсе; подсказка ложится на строку совпадения и не
// меняет его состояния; ответ не по схеме помечается и при той же конфигурации не повторяется; модель
// не отвечает — проход останавливается. Модель подменена, сети нет.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../../__tests__/integration/db.js';
import type { ILlmResult } from '../../llm/client.js';
import type { IDomRfHint } from '../../llm/domrfHint/schema.js';
import { DOMRF_HOST } from './domrfCards.js';
import { listDomRfCompanies } from './domrfCompanies.js';
import { domRfHintCounts, runDomRfHintPass, type DomRfHintCaller } from './domrfHints.js';

const pool = getPool;
const usage = { tokensIn: 10, tokensOut: 5, latencyMs: 1 };
const answer = (verdict: IDomRfHint['verdict'], reason: string): ILlmResult<IDomRfHint> => ({ ok: true, data: { verdict, reason }, usage, rawResponse: '{}' });

let company = 0;
let first = 0;
let second = 0;

const link = async (ref: string, name: string): Promise<number> =>
  (
    await pool().query<{ id: number }>(
      `INSERT INTO domrf_company_links (company_id, kind, external_ref, name, details, found_by, rank)
       VALUES ($1, 'developer', $2, $3, 'Москва', 'name', 1) RETURNING id`,
      [company, ref, name],
    )
  ).rows[0]!.id;

const setAi = async (ai: 'approved' | 'unknown'): Promise<void> => {
  await insertSyntheticSource({ kind: 'website', key: DOMRF_HOST, access: 'approved', ai });
};

beforeAll(async () => {
  await resetAndMigrate();
  company = (await pool().query<{ id: number }>(`INSERT INTO companies (name, name_norm, name_latin) VALUES ('Демо-Альфа', 'демо альфа', 'demo alfa') RETURNING id`)).rows[0]!.id;
  first = await link('901', 'ООО СЗ ДЕМО-АЛЬФА');
  second = await link('902', 'ООО СЗ ДЕМО-БЕТА');
});

afterAll(async () => {
  await closeDb();
});

describe('подсказка модели к совпадению с реестром', () => {
  it('без ИИ-допуска источника модель не зовут', async () => {
    await setAi('unknown');
    let calls = 0;
    const caller: DomRfHintCaller = async () => {
      calls += 1;
      return answer('match', 'x');
    };
    expect(await runDomRfHintPass(10, caller)).toEqual([]);
    expect(calls).toBe(0);
  });

  it('с допуском: подсказка ложится на строку, состояние совпадения не меняется; ответ не по схеме помечается', async () => {
    await setAi('approved');
    const seen: string[] = [];
    const caller: DomRfHintCaller = async body => {
      seen.push(body);
      return seen.length === 1
        ? answer('match', 'Совпадает название, объекты в Москве.')
        : { ok: false, failure: 'schema_error', message: 'verdict: неверное значение', usage, rawResponse: '{}' };
    };
    const results = await runDomRfHintPass(10, caller);
    expect(results.map(r => r.outcome)).toEqual(['saved', 'invalid']);
    expect(seen[0]).toContain('Название: Демо-Альфа');
    expect(seen[0]).toContain('Название: ООО СЗ ДЕМО-АЛЬФА');

    const rows = (await pool().query<{ id: number; state: string; hint_verdict: string | null; hint_error: string | null }>(
      'SELECT id, state, hint_verdict, hint_error FROM domrf_company_links ORDER BY id',
    )).rows;
    expect(rows).toEqual([
      { id: first, state: 'pending', hint_verdict: 'match', hint_error: null },
      { id: second, state: 'pending', hint_verdict: null, hint_error: 'schema_error: verdict: неверное значение' },
    ]);
    expect(await domRfHintCounts()).toEqual({ hinted: 2, waiting: 0 });

    // Та же модель и версия промпта — второй раз не зовём, в том числе после ответа не по схеме.
    expect(await runDomRfHintPass(10, async () => answer('no_match', 'x'))).toEqual([]);

    const listed = (await listDomRfCompanies({ filter: 'pending' })).items[0]!;
    expect(listed.links[0]).toMatchObject({ id: first, details: 'Москва', hint: { verdict: 'match', reason: 'Совпадает название, объекты в Москве.' } });
  });

  it('модель не отвечает — проход останавливается, строка не помечается', async () => {
    await pool().query(`UPDATE domrf_company_links SET hint_model = NULL, hint_prompt_version = NULL, hinted_at = NULL, hint_verdict = NULL, hint_error = NULL`);
    const results = await runDomRfHintPass(10, async () => ({ ok: false, failure: 'llm_error', message: 'HTTP 503', usage, rawResponse: null }));
    expect(results).toEqual([{ linkId: first, outcome: 'model_error', reason: 'HTTP 503' }]);
    expect(await domRfHintCounts()).toEqual({ hinted: 0, waiting: 2 });
  });

  it('решённые совпадения подсказок не получают', async () => {
    await pool().query(`UPDATE domrf_company_links SET state = 'rejected', decided_by = 'oper', decided_at = now()`);
    let calls = 0;
    await runDomRfHintPass(10, async () => {
      calls += 1;
      return answer('unsure', 'x');
    });
    expect(calls).toBe(0);
  });
});
