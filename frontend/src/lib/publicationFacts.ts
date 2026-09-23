// Что сказано о компании в публикации — одной строкой для списка публикаций.
//
// Слова берутся из словарей labels.ts, машинные ключи на экран не попадают. Отрицание
// и неуверенность — словом, а не цветом: «не является подрядчиком» и «является
// подрядчиком» — разные сведения.

import type { IPublicationFact } from '../api/types';
import { AMOUNT_PURPOSE_LABELS, ASSERTION_ROLE_LABELS, EVENT_LABELS, MODALITY_LABELS, formatMoney } from './labels';

export const factText = (fact: IPublicationFact): string => {
  const where = fact.projectName ? ` · ${fact.projectName}` : '';
  const other = fact.otherCompanyName ? ` · ${fact.otherCompanyName}` : '';
  const money =
    fact.amount !== null
      ? ` · ${formatMoney(Number(fact.amount))}${fact.valueType ? ` (${AMOUNT_PURPOSE_LABELS[fact.valueType] ?? fact.valueType})` : ''}`
      : '';

  let text: string;
  if (fact.predicate === 'participates_in_project') {
    text = `${fact.role ? (ASSERTION_ROLE_LABELS[fact.role] ?? fact.role) : 'роль не названа'}${where}${money}`;
  } else if (fact.predicate === 'contract') {
    text = `${fact.role ? (ASSERTION_ROLE_LABELS[fact.role] ?? fact.role) : 'договор'}${other}${where}${money}`;
  } else if (fact.predicate === 'corporate_relation') {
    text = `${fact.role ? (ASSERTION_ROLE_LABELS[fact.role] ?? fact.role) : 'корпоративная связь'}${other}`;
  } else if (fact.predicate === 'event') {
    text = `${fact.eventType ? (EVENT_LABELS[fact.eventType] ?? fact.eventType) : 'событие'}${other}${where}${money}`;
  } else {
    text = `упоминание${where}`;
  }

  const negated = fact.polarity === 'negative' ? 'отрицается: ' : '';
  const modality =
    fact.modality && fact.modality !== 'reported_fact' && fact.modality !== 'unknown'
      ? ` (${MODALITY_LABELS[fact.modality] ?? fact.modality})`
      : '';
  return `${negated}${text}${modality}`;
};
