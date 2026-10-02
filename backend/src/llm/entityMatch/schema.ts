// Схема ответа модели по паре «возможный дубль» (entity-match@1).
//
// strict: true требует все свойства в required и additionalProperties: false —
// иначе строгую схему не примут ни LM Studio, ни хостинги OpenRouter (см. TG_Info/CLAUDE.md).

import { z } from 'zod';

export const ENTITY_MATCH_VERDICTS = ['same', 'different', 'unsure'] as const;
export type EntityMatchVerdict = (typeof ENTITY_MATCH_VERDICTS)[number];

/** Причина — одна-две фразы рядом с парой; длиннее обрезается по слову. */
export const ENTITY_MATCH_REASON_MAX = 300;

export const ENTITY_MATCH_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: [...ENTITY_MATCH_VERDICTS], description: 'same — одна и та же, different — разные, unsure — данных не хватает' },
    reason: { type: 'string', description: 'Почему, одна-две фразы по-русски, только по данным запроса' },
  },
} as const;

export interface IEntityMatch {
  verdict: EntityMatchVerdict;
  reason: string;
}

const trimReason = (raw: string): string => {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= ENTITY_MATCH_REASON_MAX) return flat;
  const cut = flat.slice(0, ENTITY_MATCH_REASON_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

export const entityMatchSchema = z
  .object({ verdict: z.enum(ENTITY_MATCH_VERDICTS), reason: z.string() })
  .transform(value => ({ verdict: value.verdict, reason: trimReason(value.reason) }))
  .refine(value => value.reason.length > 0, { message: 'пустое объяснение' });
