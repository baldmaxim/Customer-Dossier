// Токен оператора — единственный секрет для входа в локальный портал.
//
// Источник: OPERATOR_TOKEN из backend/.env либо, если он не задан, локальный
// файл backend/.local/operator-token, созданный при первом запуске. Файл, а не
// вывод в консоль: токен не должен оказаться в логах, истории терминала или
// скриншоте. Во фронтенд, URL и localStorage токен не попадает — браузер
// получает только серверную сессию в HttpOnly-cookie.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** backend/src/api (или backend/dist/api) -> backend/.local */
export const LOCAL_DIR = path.resolve(HERE, '..', '..', '.local');
export const TOKEN_FILE = path.join(LOCAL_DIR, 'operator-token');

export interface IOperatorToken {
  token: string;
  /** Что показать в логе: откуда токен, без самого значения. */
  description: string;
}

export const resolveOperatorToken = (
  fromEnv: string | null,
  tokenFile: string = TOKEN_FILE,
): IOperatorToken => {
  if (fromEnv !== null) {
    return { token: fromEnv, description: 'из OPERATOR_TOKEN (backend/.env)' };
  }

  if (fs.existsSync(tokenFile)) {
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    if (token.length >= 32) {
      return { token, description: `из файла ${tokenFile}` };
    }
  }

  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  const token = crypto.randomBytes(32).toString('base64url');
  // mode 0o600 на Windows не действует полностью, но на POSIX закрывает файл
  // от других пользователей машины.
  fs.writeFileSync(tokenFile, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return { token, description: `создан новый, лежит в файле ${tokenFile}` };
};
