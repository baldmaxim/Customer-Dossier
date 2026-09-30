// Шифрование ключа OpenRouter для базы (миграция 032): ключ шифрования — от пароля базы, имя секрета — AAD.

import { describe, expect, it } from 'vitest';

import { openSecret, sealSecret, secretKeyFromDatabaseUrl } from './secretBox.js';

const SECRET = 'sk-or-v1-0123456789abcdef';
const URL_A = 'postgresql://tg_info:p%40ss-word@127.0.0.1:5432/tg_info';
const URL_B = 'postgresql://tg_info:other-password@127.0.0.1:5432/tg_info';

describe('secretBox', () => {
  it('расшифровывает своим ключом; в шифротексте нет открытого текста; IV случайный', () => {
    const key = secretKeyFromDatabaseUrl(URL_A);
    if (!key) throw new Error('ключ не выведен');
    const sealed = sealSecret(key, 'openrouter_api_key', SECRET);
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain(SECRET);
    expect(sealSecret(key, 'openrouter_api_key', SECRET)).not.toBe(sealed);
    expect(openSecret(key, 'openrouter_api_key', sealed)).toBe(SECRET);
  });

  it('другой пароль базы, другое имя секрета или правка шифротекста — секрета нет, а не мусор', () => {
    const key = secretKeyFromDatabaseUrl(URL_A);
    const other = secretKeyFromDatabaseUrl(URL_B);
    if (!key || !other) throw new Error('ключ не выведен');
    const sealed = sealSecret(key, 'openrouter_api_key', SECRET);
    expect(openSecret(other, 'openrouter_api_key', sealed)).toBeNull();
    expect(openSecret(key, 'other_secret', sealed)).toBeNull();
    const [format, iv, tag, data] = sealed.split(':');
    const flipped = Buffer.from(data ?? '', 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(openSecret(key, 'openrouter_api_key', [format, iv, tag, flipped.toString('base64')].join(':'))).toBeNull();
    expect(openSecret(key, 'openrouter_api_key', 'v2:x:y:z')).toBeNull();
    expect(openSecret(key, 'openrouter_api_key', 'не шифротекст')).toBeNull();
  });

  it('без пароля в строке подключения шифровать нечем; пароль берётся раскодированным', () => {
    expect(secretKeyFromDatabaseUrl('postgresql://tg_info@127.0.0.1/tg_info')).toBeNull();
    expect(secretKeyFromDatabaseUrl('не адрес')).toBeNull();
    const encoded = secretKeyFromDatabaseUrl(URL_A);
    const plain = secretKeyFromDatabaseUrl('postgresql://tg_info:p@ss-word@127.0.0.1:5432/tg_info');
    expect(encoded?.equals(plain ?? Buffer.alloc(0))).toBe(true);
  });
});
