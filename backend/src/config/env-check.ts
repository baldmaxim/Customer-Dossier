// Диагностика .env — почему переменная «вписана», а программа её не видит.
//
// БЕЗОПАСНОСТЬ: отсюда наружу выходят только ИМЕНА ключей и признак
// «задан / пуст». Значения не читаются в вывод ни при каких условиях —
// ни целиком, ни обрезанные, ни их длина (длина токена тоже подсказка).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** backend/src/config -> backend */
const BACKEND_ROOT = path.resolve(HERE, '..', '..');

/** Единственный файл, который читает dotenv при запуске из backend/. */
const ENV_PATH = path.join(BACKEND_ROOT, '.env');

/**
 * Куда люди кладут .env по ошибке.
 *
 * `.env.txt` — самый частый случай на Windows: «Блокнот» дописывает
 * расширение, а проводник его прячет, и файл выглядит правильно названным.
 */
const DECOY_PATHS = [
  path.join(BACKEND_ROOT, '.env.txt'),
  path.join(BACKEND_ROOT, '.env.local'),
  path.join(BACKEND_ROOT, 'env'),
  path.join(BACKEND_ROOT, '..', '.env'),
  path.join(BACKEND_ROOT, '..', 'frontend', '.env'),
];

const REQUIRED = ['DATABASE_URL'] as const;

const OPTIONAL = [
  'LMSTUDIO_BASE_URL',
  'LMSTUDIO_MODEL',
  'PROMPT_VERSION',
  'TG_BOT_TOKEN',
  'TG_BOT_ALLOWED_USER_IDS',
] as const;

export interface IEnvKey {
  name: string;
  /** Ключ есть в файле и значение непустое. Само значение никуда не попадает. */
  filled: boolean;
}

export interface IEnvCheck {
  envPath: string;
  exists: boolean;
  keys: IEnvKey[];
  decoys: string[];
  problems: string[];
}

/** Разбор строк вида KEY=VALUE. Возвращает только имена и признак заполненности. */
const readKeyNames = (filePath: string): IEnvKey[] => {
  const content = fs.readFileSync(filePath, 'utf8');
  const keys: IEnvKey[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const name = line.slice(0, eq).trim().replace(/^export\s+/, '');
    const value = line.slice(eq + 1).trim();
    // Значение дальше этой строки не уходит: наружу отдаём только факт.
    keys.push({ name, filled: value !== '' && value !== '""' && value !== "''" });
  }

  return keys;
};

export const checkEnvFile = (): IEnvCheck => {
  const problems: string[] = [];
  const decoys = DECOY_PATHS.filter(p => fs.existsSync(p)).map(p => path.resolve(p));

  if (!fs.existsSync(ENV_PATH)) {
    problems.push(`Файл не найден: ${ENV_PATH}`);
    if (decoys.length > 0) {
      problems.push(
        `Но рядом лежит: ${decoys.join(', ')}. Переименуйте в backend/.env — ` +
          'программа читает только его.',
      );
    } else {
      problems.push('Создайте его: скопируйте backend/.env.example в backend/.env');
    }
    return { envPath: ENV_PATH, exists: false, keys: [], decoys, problems };
  }

  const keys = readKeyNames(ENV_PATH);
  const byName = new Map(keys.map(k => [k.name, k]));

  for (const name of REQUIRED) {
    const key = byName.get(name);
    if (!key) problems.push(`Нет обязательного ключа ${name}`);
    else if (!key.filled) problems.push(`Ключ ${name} есть, но значение пустое`);
  }

  // Типичная опечатка: имя ключа без префикса или в другом регистре.
  for (const name of OPTIONAL) {
    if (byName.has(name)) continue;
    const similar = keys.find(
      k => k.name.toUpperCase().replace(/[^A-Z]/g, '') === name.replace(/[^A-Z]/g, ''),
    );
    if (similar) {
      problems.push(`Ключ ${similar.name} похож на ${name} — программа ищет точное имя ${name}`);
    }
  }

  if (decoys.length > 0) {
    problems.push(
      `Есть и другие файлы: ${decoys.join(', ')}. Читается только backend/.env — ` +
        'проверьте, что правите именно его.',
    );
  }

  return { envPath: ENV_PATH, exists: true, keys, decoys, problems };
};

/** Печать отчёта. Значения не выводятся — только имена и «задан / пуст». */
export const printEnvCheck = (check: IEnvCheck): void => {
  console.log(`[env] файл: ${check.envPath}`);
  console.log(`[env] существует: ${check.exists ? 'да' : 'НЕТ'}`);

  if (check.keys.length > 0) {
    console.log(`[env] ключей в файле: ${check.keys.length} (значения не показываются)`);
    for (const key of check.keys) {
      console.log(`   ${key.filled ? '✓' : '✗ пусто'}  ${key.name}`);
    }
  }

  for (const problem of check.problems) console.error(`[env] ${problem}`);

  if (check.problems.length === 0) {
    console.log('[env] проблем не нашёл');
  }
};
