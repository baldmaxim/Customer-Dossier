// Каноническая сериализация снимка (sha256-canonical-json@1): ключи объектов по возрастанию (code units),
// массивы в исходном порядке, без пробелов, числа — как JSON.stringify, строки NFC. Hash показывает
// целостность payload, а не подпись и не истинность фактов.

import { createHash } from 'node:crypto';

export const HASH_ALGORITHM = 'sha256-canonical-json@1';

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonicalJson: нечисловое значение');
    if (value === undefined) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
};

export const payloadHash = (payload: unknown): string => createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
