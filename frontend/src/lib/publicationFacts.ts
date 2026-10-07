// Что сказано о компании в публикации: одной строкой для списка публикаций и по частям —
// со ссылками на объект и компанию — под постом.
//
// Слова берутся из словарей labels.ts, машинные ключи на экран не попадают. Отрицание
// и неуверенность — словом, а не цветом: «не является подрядчиком» и «является
// подрядчиком» — разные сведения.

import type { IPublicationFact } from '../api/types';
import { AMOUNT_PURPOSE_LABELS, ASSERTION_ROLE_LABELS, EVENT_LABELS, MODALITY_LABELS, formatMoney } from './labels';

/** Упоминание без роли и события — пустой шум в списке сведений. */
export const SILENT_PREDICATES: ReadonlySet<string> = new Set(['company_mentioned', 'project_mentioned']);

export interface IFactRef {
  /** null — сервер не дал id: название без ссылки. */
  id: number | null;
  name: string;
}

export interface IFactView {
  key: string;
  /** Сведение о другом юрлице семьи (СЗ группы): лента компании — по семье, и чьё это сведение, сказано словами. */
  via: IFactRef | null;
  /** Что сказано: «генподрядчик», «договор генподряда», «Ввод в эксплуатацию». */
  label: string;
  other: IFactRef | null;
  project: IFactRef | null;
  /** «4,8 млрд ₽ (цена договора)». */
  money: string | null;
  /** Не факт, а заявление, план, слух — словом. */
  qualifier: string | null;
  negated: boolean;
}

/** Незнакомый серверу словарю ключ — общим словом, а не машинным значением на экране. */
const roleOr = (role: string | null, fallback: string): string => (role ? (ASSERTION_ROLE_LABELS[role] ?? fallback) : fallback);

const labelOf = (fact: IPublicationFact): string => {
  switch (fact.predicate) {
    case 'participates_in_project':
      return roleOr(fact.role, 'роль не названа');
    case 'contract':
      return roleOr(fact.role, 'договор');
    case 'corporate_relation':
      return roleOr(fact.role, 'корпоративная связь');
    case 'event':
      return fact.eventType ? (EVENT_LABELS[fact.eventType] ?? 'событие') : 'событие';
    default:
      return 'упоминание';
  }
};

export const factView = (fact: IPublicationFact, index = 0): IFactView => {
  // «цена договора 4,8 млрд ₽»: что за сумма — словом перед числом, а не второй скобкой после валюты.
  const money =
    fact.amount !== null
      ? [fact.valueType ? (AMOUNT_PURPOSE_LABELS[fact.valueType] ?? 'сумма') : null, formatMoney(fact.amount, fact.currency)]
          .filter(Boolean)
          .join(' ')
      : null;
  return {
    key: `${fact.assertionId ?? 'x'}-${index}`,
    via: fact.viaCompanyName ? { id: fact.viaCompanyId ?? null, name: fact.viaCompanyName } : null,
    label: labelOf(fact),
    // Корпоративная связь и договор называют вторую сторону; у участия её нет.
    other: fact.otherCompanyName ? { id: fact.otherCompanyId, name: fact.otherCompanyName } : null,
    project: fact.projectName ? { id: fact.projectId, name: fact.projectName } : null,
    money,
    qualifier:
      fact.modality && fact.modality !== 'reported_fact' && fact.modality !== 'unknown'
        ? (MODALITY_LABELS[fact.modality] ?? null)
        : null,
    negated: fact.polarity === 'negative',
  };
};

/** Одной строкой: «генподрядчик · Развязка на М-7», «отрицается: подрядчик (заявление)». */
export const factViewText = (view: IFactView): string => {
  const body = [view.label, view.other?.name, view.project?.name, view.money].filter(Boolean).join(' · ');
  return `${view.via ? `${view.via.name}: ` : ''}${view.negated ? 'отрицается: ' : ''}${body}${view.qualifier ? ` (${view.qualifier})` : ''}`;
};

export const factText = (fact: IPublicationFact): string => factViewText(factView(fact));
