// Шифрование секретов из админки (ключ OpenRouter) для хранения в базе (миграция 032).
//
// AES-256-GCM; ключ шифрования — HKDF-SHA256 от пароля из DATABASE_URL. Пароля нет в дампе
// (pg_dump не выгружает роли), поэтому утёкший дамп секрет не раскрывает. База, поднятая под
// другим паролем, секрет не расшифрует — его вводят заново. Имя секрета — дополнительные данные
// GCM: шифротекст одной строки не подставить в другую. Без пароля в DATABASE_URL шифровать
// нечем — такой секрет в базу не пишется.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const FORMAT = 'v1';
const SALT = 'tg-info/app-secrets';
const INFO = 'aes-256-gcm@1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Ключ шифрования из строки подключения; null — пароля нет или строка не разбирается. */
export const secretKeyFromDatabaseUrl = (databaseUrl: string): Buffer | null => {
  let password: string;
  try {
    password = decodeURIComponent(new URL(databaseUrl).password);
  } catch {
    return null;
  }
  if (password === '') return null;
  return Buffer.from(hkdfSync('sha256', password, SALT, INFO, 32));
};

export const sealSecret = (key: Buffer, name: string, plaintext: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(name, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [FORMAT, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
};

/** null — другой ключ, чужое имя, повреждённый или незнакомый формат: секрета нет, а не мусор. */
export const openSecret = (key: Buffer, name: string, sealed: string): string | null => {
  const [format, iv, tag, data, ...rest] = sealed.split(':');
  if (format !== FORMAT || iv === undefined || tag === undefined || data === undefined || rest.length > 0) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(name, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};
