// Ключ OpenRouter из админки на настоящей базе (миграция 032): в строке — только шифротекст и четыре
// последних символа, испорченный шифротекст не становится ключом, удаление возвращает .env.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { clearLlmKey, llmKeyStatus, loadStoredLlmKey, saveLlmKey } from './llmKey.js';

const SECRET = 'sk-or-v1-integration-key-7731';

beforeAll(async () => {
  await resetAndMigrate();
});

afterAll(async () => {
  await closeDb();
});

describe('app_secrets: ключ OpenRouter', () => {
  it('сохраняется шифротекстом; перечитывается из базы; кто и когда — видно', async () => {
    const saved = await saveLlmKey(` ${SECRET} `, 'alpha');
    expect(saved).toMatchObject({ ok: true, status: { source: 'admin', hint: '7731', updatedBy: 'alpha', problem: null } });

    const row = (await getPool().query<{ ciphertext: string; hint: string }>('SELECT ciphertext, hint FROM app_secrets')).rows[0];
    expect(row?.hint).toBe('7731');
    expect(row?.ciphertext).not.toContain(SECRET);
    expect(row?.ciphertext.startsWith('v1:')).toBe(true);

    expect(await loadStoredLlmKey()).toMatchObject({ source: 'admin', hint: '7731', problem: null });
  });

  it('новый ключ заменяет прежний, строка одна', async () => {
    await saveLlmKey('sk-or-v1-integration-key-0002', 'beta');
    const rows = (await getPool().query('SELECT name FROM app_secrets')).rows;
    expect(rows).toHaveLength(1);
    expect(llmKeyStatus()).toMatchObject({ hint: '0002', updatedBy: 'beta' });
  });

  it('испорченный шифротекст — ключа нет, экран говорит почему', async () => {
    await getPool().query(`UPDATE app_secrets SET ciphertext = 'v1:AAAA:AAAA:AAAA'`);
    expect(await loadStoredLlmKey()).toMatchObject({ source: 'none', problem: 'undecryptable', hint: '0002' });
  });

  it('удаление: строки нет, действует .env; незнакомое имя секрета база не примет', async () => {
    expect(await clearLlmKey('alpha')).toMatchObject({ source: 'none', hint: null, problem: null });
    expect((await getPool().query('SELECT 1 FROM app_secrets')).rowCount).toBe(0);
    await expect(
      getPool().query(`INSERT INTO app_secrets (name, ciphertext, hint, updated_by) VALUES ('other', 'x', 'x', 'alpha')`),
    ).rejects.toThrow(/app_secrets_name_known/);
  });
});
