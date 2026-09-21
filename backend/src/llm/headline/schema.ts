// Схема ответа модели для темы публикации (headline@1).
//
// strict: true требует все свойства в required и additionalProperties: false —
// иначе LM Studio отвергнет запрос (см. TG_Info/CLAUDE.md).

import { z } from 'zod';

export const HEADLINE_SCHEMA_VERSION = 'headline@1';

/** Тема длиннее этого — обрезается по последнему целому слову: это подпись строки, а не текст. */
export const HEADLINE_MAX_CHARS = 120;

export const HEADLINE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topic'],
  properties: {
    topic: { type: 'string', description: 'Тема текста одной строкой, 5–9 слов' },
  },
} as const;

export interface IHeadline {
  topic: string;
}

/**
 * Обрезка по слову: модель иногда выдаёт целый абзац вместо строки. Резать посередине
 * слова хуже, чем отбросить хвост — строка должна читаться.
 */
export const trimTopic = (raw: string): string => {
  const flat = raw.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
  if (flat.length <= HEADLINE_MAX_CHARS) return flat;
  const cut = flat.slice(0, HEADLINE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

export const headlineSchema = z
  .object({ topic: z.string() })
  .transform(value => ({ topic: trimTopic(value.topic) }))
  .refine(value => value.topic.length > 0, { message: 'пустая тема' });
