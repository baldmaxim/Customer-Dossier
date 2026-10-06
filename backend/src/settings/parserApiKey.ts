// Ключ parser-api.com, заданный в админке («Источники» → parser-api.com, этап 24A; хранилище — миграция 032, 044).
//
// Устроен как ключ OpenRouter (settings/llmKey.ts): в базе — шифротекст, в памяти процесса —
// расшифрованный ключ для клиента parser-api (parserApi/client.ts). Ключ из админки главнее PARSER_API_KEY
// из .env; удалили в админке — снова действует .env. Наружу — только источник, четыре последних
// символа, кто и когда задал. Ключ — лимит тарифа: задаёт только администратор (parserapi.manage).

import { env } from '../config/env.js';
import { execute, queryOne } from '../db/pool.js';
import { openSecret, sealSecret, secretKeyFromDatabaseUrl } from './secretBox.js';

export const PARSER_API_KEY_NAME = 'parser_api_key';

/** Ключ — одна строка печатных символов без пробелов, как его выдаёт сервис. */
const KEY_RE = /^[\x21-\x7e]{8,512}$/;

export type ParserApiKeySource = 'admin' | 'env' | 'none';
/** store_missing — миграция 032 не применена; undecryptable — ключ шифрования другой (сменили пароль базы). */
export type ParserApiKeyProblem = 'store_missing' | 'undecryptable' | null;

export interface IParserApiKeyStatus {
  source: ParserApiKeySource;
  hint: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  envKeySet: boolean;
  problem: ParserApiKeyProblem;
  /** В DATABASE_URL есть пароль, из него выводится ключ шифрования: хранить в базе можно. */
  canStore: boolean;
}

interface IState {
  key: string | null;
  hint: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  problem: ParserApiKeyProblem;
}

const EMPTY: IState = { key: null, hint: null, updatedAt: null, updatedBy: null, problem: null };
let state: IState = EMPTY;

const isMissingTable = (err: unknown): boolean => (err as { code?: string }).code === '42P01';

const boxKey = (): Buffer | null => secretKeyFromDatabaseUrl(env.DATABASE_URL);

export const normalizeParserApiKey = (raw: string): string | null => {
  const key = raw.trim();
  return KEY_RE.test(key) ? key : null;
};

/** Действующий ключ: из админки, иначе из .env; null — запросов к parser-api.com не будет. */
export const parserApiKey = (): string | null => state.key ?? (env.PARSER_API_KEY !== '' ? env.PARSER_API_KEY : null);

export const parserApiKeyStatus = (): IParserApiKeyStatus => ({
  source: state.key !== null ? 'admin' : env.PARSER_API_KEY !== '' ? 'env' : 'none',
  hint: state.hint,
  updatedAt: state.updatedAt?.toISOString() ?? null,
  updatedBy: state.updatedBy,
  envKeySet: env.PARSER_API_KEY !== '',
  problem: state.problem,
  canStore: boxKey() !== null,
});

/** Перечитать ключ из базы в память процесса: при старте, перед показом в админке, перед проходом. */
export const loadStoredParserApiKey = async (): Promise<IParserApiKeyStatus> => {
  let row: { ciphertext: string; hint: string; updated_at: Date; updated_by: string } | null;
  try {
    row = await queryOne('SELECT ciphertext, hint, updated_at, updated_by FROM app_secrets WHERE name = $1', [PARSER_API_KEY_NAME]);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    state = { ...EMPTY, problem: 'store_missing' };
    return parserApiKeyStatus();
  }
  if (!row) {
    state = EMPTY;
    return parserApiKeyStatus();
  }
  const box = boxKey();
  const key = box ? openSecret(box, PARSER_API_KEY_NAME, row.ciphertext) : null;
  state = { key, hint: row.hint, updatedAt: row.updated_at, updatedBy: row.updated_by, problem: key === null ? 'undecryptable' : null };
  return parserApiKeyStatus();
};

export type SaveParserApiKeyResult =
  | { ok: true; status: IParserApiKeyStatus }
  | { ok: false; code: 'invalid_key' | 'no_db_password' | 'store_missing' | 'unknown_name' };

export const saveParserApiKey = async (raw: string, actor: string): Promise<SaveParserApiKeyResult> => {
  const key = normalizeParserApiKey(raw);
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
      [PARSER_API_KEY_NAME, sealSecret(box, PARSER_API_KEY_NAME, key), hint, actor],
    );
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, code: 'store_missing' };
    // Миграция 044 не применена: CHECK хранилища не знает ключ parser-api.
    if ((err as { code?: string }).code === '23514') return { ok: false, code: 'unknown_name' };
    throw err;
  }
  state = { key, hint, updatedAt: row?.updated_at ?? new Date(), updatedBy: actor, problem: null };
  console.log(`[parser-api] ключ parser-api.com задан в админке: ${actor}`);
  return { ok: true, status: parserApiKeyStatus() };
};

/** Удалить ключ из админки: дальше действует PARSER_API_KEY из .env, если он задан. */
export const clearParserApiKey = async (actor: string): Promise<IParserApiKeyStatus> => {
  try {
    await execute('DELETE FROM app_secrets WHERE name = $1', [PARSER_API_KEY_NAME]);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    state = { ...EMPTY, problem: 'store_missing' };
    return parserApiKeyStatus();
  }
  state = EMPTY;
  console.log(`[parser-api] ключ parser-api.com удалён из админки: ${actor}`);
  return parserApiKeyStatus();
};
