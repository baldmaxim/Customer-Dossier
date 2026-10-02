// Ключ Контур.Фокуса, заданный в админке («Источники» → Контур.Фокус, ADR-015; хранилище — миграция 032).
//
// Устроен как ключ OpenRouter (settings/llmKey.ts): в базе — шифротекст, в памяти процесса —
// расшифрованный ключ для клиента Фокуса (focus/client.ts). Ключ из админки главнее FOCUS_API_KEY
// из .env; удалили в админке — снова действует .env. Наружу — только источник, четыре последних
// символа, кто и когда задал. Ключ — деньги тарифа: задаёт только администратор (focus.manage).

import { env } from '../config/env.js';
import { execute, queryOne } from '../db/pool.js';
import { openSecret, sealSecret, secretKeyFromDatabaseUrl } from './secretBox.js';

export const FOCUS_KEY_NAME = 'kontur_focus_api_key';

/** Ключ — одна строка печатных символов без пробелов, как его выдаёт Контур. */
const KEY_RE = /^[\x21-\x7e]{8,512}$/;

export type FocusKeySource = 'admin' | 'env' | 'none';
/** store_missing — миграция 032 не применена; undecryptable — ключ шифрования другой (сменили пароль базы). */
export type FocusKeyProblem = 'store_missing' | 'undecryptable' | null;

export interface IFocusKeyStatus {
  source: FocusKeySource;
  hint: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  envKeySet: boolean;
  problem: FocusKeyProblem;
  /** В DATABASE_URL есть пароль, из него выводится ключ шифрования: хранить в базе можно. */
  canStore: boolean;
}

interface IState {
  key: string | null;
  hint: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  problem: FocusKeyProblem;
}

const EMPTY: IState = { key: null, hint: null, updatedAt: null, updatedBy: null, problem: null };
let state: IState = EMPTY;

const isMissingTable = (err: unknown): boolean => (err as { code?: string }).code === '42P01';

const boxKey = (): Buffer | null => secretKeyFromDatabaseUrl(env.DATABASE_URL);

export const normalizeFocusKey = (raw: string): string | null => {
  const key = raw.trim();
  return KEY_RE.test(key) ? key : null;
};

/** Действующий ключ: из админки, иначе из .env; null — запросов к Фокусу не будет. */
export const focusApiKey = (): string | null => state.key ?? (env.FOCUS_API_KEY !== '' ? env.FOCUS_API_KEY : null);

export const focusKeyStatus = (): IFocusKeyStatus => ({
  source: state.key !== null ? 'admin' : env.FOCUS_API_KEY !== '' ? 'env' : 'none',
  hint: state.hint,
  updatedAt: state.updatedAt?.toISOString() ?? null,
  updatedBy: state.updatedBy,
  envKeySet: env.FOCUS_API_KEY !== '',
  problem: state.problem,
  canStore: boxKey() !== null,
});

/** Перечитать ключ из базы в память процесса: при старте, перед показом в админке, перед проходом. */
export const loadStoredFocusKey = async (): Promise<IFocusKeyStatus> => {
  let row: { ciphertext: string; hint: string; updated_at: Date; updated_by: string } | null;
  try {
    row = await queryOne('SELECT ciphertext, hint, updated_at, updated_by FROM app_secrets WHERE name = $1', [FOCUS_KEY_NAME]);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    state = { ...EMPTY, problem: 'store_missing' };
    return focusKeyStatus();
  }
  if (!row) {
    state = EMPTY;
    return focusKeyStatus();
  }
  const box = boxKey();
  const key = box ? openSecret(box, FOCUS_KEY_NAME, row.ciphertext) : null;
  state = { key, hint: row.hint, updatedAt: row.updated_at, updatedBy: row.updated_by, problem: key === null ? 'undecryptable' : null };
  return focusKeyStatus();
};

export type SaveFocusKeyResult =
  | { ok: true; status: IFocusKeyStatus }
  | { ok: false; code: 'invalid_key' | 'no_db_password' | 'store_missing' | 'unknown_name' };

export const saveFocusKey = async (raw: string, actor: string): Promise<SaveFocusKeyResult> => {
  const key = normalizeFocusKey(raw);
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
      [FOCUS_KEY_NAME, sealSecret(box, FOCUS_KEY_NAME, key), hint, actor],
    );
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, code: 'store_missing' };
    // Миграция 040 не применена: CHECK хранилища знает только ключ OpenRouter.
    if ((err as { code?: string }).code === '23514') return { ok: false, code: 'unknown_name' };
    throw err;
  }
  state = { key, hint, updatedAt: row?.updated_at ?? new Date(), updatedBy: actor, problem: null };
  console.log(`[focus] ключ Контур.Фокуса задан в админке: ${actor}`);
  return { ok: true, status: focusKeyStatus() };
};

/** Удалить ключ из админки: дальше действует FOCUS_API_KEY из .env, если он задан. */
export const clearFocusKey = async (actor: string): Promise<IFocusKeyStatus> => {
  try {
    await execute('DELETE FROM app_secrets WHERE name = $1', [FOCUS_KEY_NAME]);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    state = { ...EMPTY, problem: 'store_missing' };
    return focusKeyStatus();
  }
  state = EMPTY;
  console.log(`[focus] ключ Контур.Фокуса удалён из админки: ${actor}`);
  return focusKeyStatus();
};
