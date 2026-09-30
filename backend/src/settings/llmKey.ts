// Ключ OpenRouter, заданный в админке (вкладка «Модель», миграция 032).
//
// В базе — шифротекст (settings/secretBox.ts), в памяти процесса — расшифрованный ключ для клиента
// модели (llm/client.ts). Ключ из админки главнее LLM_API_KEY из .env; удалили в админке — снова
// действует .env. Наружу — только источник, четыре последних символа, кто и когда задал.

import { env } from '../config/env.js';
import { execute, queryOne } from '../db/pool.js';
import { setAdminLlmApiKey } from '../llm/client.js';
import { openSecret, sealSecret, secretKeyFromDatabaseUrl } from './secretBox.js';

export const OPENROUTER_KEY_NAME = 'openrouter_api_key';

/** Ключ — одна строка печатных символов без пробелов, как его выдаёт OpenRouter. */
const KEY_RE = /^[\x21-\x7e]{8,512}$/;

export type LlmKeySource = 'admin' | 'env' | 'none';
/** store_missing — миграция 032 не применена; undecryptable — ключ шифрования другой (сменили пароль базы). */
export type LlmKeyProblem = 'store_missing' | 'undecryptable' | null;

export interface ILlmKeyStatus {
  source: LlmKeySource;
  /** Последние четыре символа ключа из админки. */
  hint: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Ключ из .env действует, если в админке ключа нет. При LM Studio не действует ни один. */
  envKeySet: boolean;
  problem: LlmKeyProblem;
  /** В DATABASE_URL есть пароль, из него выводится ключ шифрования: хранить в базе можно. */
  canStore: boolean;
}

interface IStoredRow {
  ciphertext: string;
  hint: string;
  updated_at: Date;
  updated_by: string;
}

interface IState {
  active: boolean;
  hint: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  problem: LlmKeyProblem;
}

const EMPTY: IState = { active: false, hint: null, updatedAt: null, updatedBy: null, problem: null };
let state: IState = EMPTY;

const isMissingTable = (err: unknown): boolean => (err as { code?: string }).code === '42P01';

const boxKey = (): Buffer | null => secretKeyFromDatabaseUrl(env.DATABASE_URL);

const apply = (next: IState, key: string | null): void => {
  state = next;
  setAdminLlmApiKey(key);
};

export const normalizeLlmKey = (raw: string): string | null => {
  const key = raw.trim();
  return KEY_RE.test(key) ? key : null;
};

export const llmKeyStatus = (): ILlmKeyStatus => ({
  source: state.active ? 'admin' : env.LLM_API_KEY !== '' ? 'env' : 'none',
  hint: state.hint,
  updatedAt: state.updatedAt?.toISOString() ?? null,
  updatedBy: state.updatedBy,
  envKeySet: env.LLM_API_KEY !== '',
  problem: state.problem,
  canStore: boxKey() !== null,
});

/** Перечитать ключ из базы в память процесса: при старте, перед показом в админке, в CLI. */
export const loadStoredLlmKey = async (): Promise<ILlmKeyStatus> => {
  let row: IStoredRow | null;
  try {
    row = await queryOne<IStoredRow>('SELECT ciphertext, hint, updated_at, updated_by FROM app_secrets WHERE name = $1', [
      OPENROUTER_KEY_NAME,
    ]);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    apply({ ...EMPTY, problem: 'store_missing' }, null);
    return llmKeyStatus();
  }
  if (!row) {
    apply(EMPTY, null);
    return llmKeyStatus();
  }
  const box = boxKey();
  const key = box ? openSecret(box, OPENROUTER_KEY_NAME, row.ciphertext) : null;
  const meta = { hint: row.hint, updatedAt: row.updated_at, updatedBy: row.updated_by };
  apply(key === null ? { ...meta, active: false, problem: 'undecryptable' } : { ...meta, active: true, problem: null }, key);
  return llmKeyStatus();
};

export type SaveLlmKeyResult = { ok: true; status: ILlmKeyStatus } | { ok: false; code: 'invalid_key' | 'no_db_password' | 'store_missing' };

export const saveLlmKey = async (raw: string, actor: string): Promise<SaveLlmKeyResult> => {
  const key = normalizeLlmKey(raw);
  if (key === null) return { ok: false, code: 'invalid_key' };
  const box = boxKey();
  if (!box) return { ok: false, code: 'no_db_password' };
  const hint = key.slice(-4);
  let row: { updated_at: Date } | null;
  try {
    row = await queryOne<{ updated_at: Date }>(
      `INSERT INTO app_secrets (name, ciphertext, hint, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext, hint = EXCLUDED.hint, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING updated_at`,
      [OPENROUTER_KEY_NAME, sealSecret(box, OPENROUTER_KEY_NAME, key), hint, actor],
    );
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, code: 'store_missing' };
    throw err;
  }
  apply({ active: true, hint, updatedAt: row?.updated_at ?? new Date(), updatedBy: actor, problem: null }, key);
  console.log(`[llm] ключ OpenRouter задан в админке: ${actor}`);
  return { ok: true, status: llmKeyStatus() };
};

/** Удалить ключ из админки: дальше действует LLM_API_KEY из .env, если он задан. */
export const clearLlmKey = async (actor: string): Promise<ILlmKeyStatus> => {
  try {
    await execute('DELETE FROM app_secrets WHERE name = $1', [OPENROUTER_KEY_NAME]);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    apply({ ...EMPTY, problem: 'store_missing' }, null);
    return llmKeyStatus();
  }
  apply(EMPTY, null);
  console.log(`[llm] ключ OpenRouter удалён из админки: ${actor}`);
  return llmKeyStatus();
};
