// Схема ответа модели для подсказки к совпадению с реестром ДОМ.РФ (domrf-hint@1).
//
// strict: true требует все свойства в required и additionalProperties: false —
// иначе строгую схему не примут ни LM Studio, ни хостинги OpenRouter (см. TG_Info/CLAUDE.md).

import { z } from 'zod';

export const DOMRF_HINT_VERDICTS = ['match', 'no_match', 'unsure'] as const;
export type DomRfHintVerdict = (typeof DOMRF_HINT_VERDICTS)[number];

/** Объяснение — одна-две фразы под кнопками; длиннее обрезается по слову. */
export const DOMRF_HINT_REASON_MAX = 300;

export const DOMRF_HINT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: [...DOMRF_HINT_VERDICTS], description: 'match — скорее та же компания, no_match — скорее другая, unsure — данных не хватает' },
    reason: { type: 'string', description: 'Почему, одна-две фразы по-русски, только по данным запроса' },
  },
} as const;

export interface IDomRfHint {
  verdict: DomRfHintVerdict;
  reason: string;
}

const trimReason = (raw: string): string => {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= DOMRF_HINT_REASON_MAX) return flat;
  const cut = flat.slice(0, DOMRF_HINT_REASON_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

export const domRfHintSchema = z
  .object({ verdict: z.enum(DOMRF_HINT_VERDICTS), reason: z.string() })
  .transform(value => ({ verdict: value.verdict, reason: trimReason(value.reason) }))
  .refine(value => value.reason.length > 0, { message: 'пустое объяснение' });
