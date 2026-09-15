// Формулировки досье: детерминированные шаблоны поверх структурированных утверждений, без модели.
//
// Каждая существенная фраза несёт id утверждений и доказательств. Атрибуция не смешивается:
// «в публикации сообщается» (есть в тексте), «аналитиком проверено» (в указанном объёме), «со слов
// обратившегося» (запись оператора), «не установлено в выборке» (отсутствие сведений, не факт отсутствия).

import type { IFact } from './facts.js';

export type Attribution = 'source_reported' | 'analyst_reviewed' | 'analyst_disputed' | 'analyst_rejected' | 'operator_claim' | 'not_established' | 'system_context';

export interface IStatement {
  code: string;
  text: string;
  attribution: Attribution;
  assertionIds: number[];
  evidenceIds: number[];
  quotes: Array<{ evidenceId: number; quote: string; sourceTitle: string; publishedAt: string | null; stance: string }>;
}

const ROLE: Record<string, string> = {
  customer: 'заказчик',
  general_contractor: 'генподрядчик',
  contractor: 'подрядчик',
  subcontractor: 'субподрядчик',
  supplier: 'поставщик',
  designer: 'проектировщик',
  investor: 'инвестор',
  operator: 'эксплуатирующая организация',
  general_contract: 'договор генподряда',
  subcontract: 'договор субподряда',
  supply: 'договор поставки',
  design_contract: 'договор на проектирование',
  contract: 'договор',
  owns_share: 'владеет долей',
  controls: 'контролирует',
  member_of_group: 'входит в группу',
  brand_of: 'бренд компании',
};

const EVENT: Record<string, string> = {
  construction_start: 'начало строительства',
  milestone: 'этап работ',
  delay: 'задержка',
  deadline_missed: 'срыв срока',
  suspension: 'приостановка работ',
  resumption: 'возобновление работ',
  cancellation: 'отмена проекта',
  commissioning: 'ввод в эксплуатацию',
  court_case: 'судебное дело',
  bankruptcy: 'банкротство',
  bankruptcy_intent: 'намерение о банкротстве',
  bankruptcy_filing: 'заявление о банкротстве',
  bankruptcy_procedure: 'процедура банкротства',
  payment_claim: 'претензия об оплате',
  contractor_change: 'смена подрядчика',
  license_revoked: 'отзыв лицензии',
  tender_award: 'победа в тендере',
  other: 'событие',
};

const PROCEDURAL: Record<string, string> = {
  plaintiff: 'истец',
  defendant: 'ответчик',
  applicant: 'заявитель',
  creditor: 'кредитор',
  debtor: 'должник',
  third_party: 'третье лицо',
};

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const STAGE: Record<string, string> = {
  claim_filed: 'иск подан',
  accepted: 'принят к производству',
  hearing: 'рассмотрение',
  decision: 'решение',
  appeal_filed: 'обжалование',
  appeal_decision: 'решение апелляции',
  cassation: 'кассация',
  enforcement: 'исполнение',
  settled: 'мировое соглашение',
  withdrawn: 'отозван',
  procedure_introduced: 'процедура введена',
  procedure_completed: 'процедура завершена',
};

const OUTCOME: Record<string, string> = {
  satisfied: 'удовлетворено',
  partially_satisfied: 'удовлетворено частично',
  dismissed: 'отказано',
  overturned: 'отменено',
  settled: 'урегулировано',
};

export const stageText = (stage: string | null): string | null => (stage ? (STAGE[stage] ?? stage) : null);
export const outcomeText = (outcome: string | null): string | null => (outcome ? (OUTCOME[outcome] ?? outcome) : null);

export const roleText = (role: string | null): string => (role ? (ROLE[role] ?? role) : 'роль не указана');
export const eventText = (type: string | null): string => (type ? (EVENT[type] ?? type) : 'событие');
export const proceduralText = (role: string | null): string | null => (role ? (PROCEDURAL[role] ?? role) : null);

/** Дата с точностью, как её подтвердил текст: «12 марта 2026», «март 2026», «2026 год», «дата не указана». */
export const dateText = (from: string | null, precision: string): string => {
  if (!from) return 'дата не указана';
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  if (precision === 'year') return `${y} год`;
  if (precision === 'quarter') return `${Math.floor((m - 1) / 3) + 1} квартал ${y}`;
  if (precision === 'month') return `${MONTHS_NOM[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

export const attributionOf = (fact: Pick<IFact, 'status'>): Attribution =>
  fact.status === 'reviewed_supported'
    ? 'analyst_reviewed'
    : fact.status === 'disputed'
      ? 'analyst_disputed'
      : fact.status === 'rejected'
        ? 'analyst_rejected'
        : 'source_reported';

const LEAD: Record<Attribution, string> = {
  source_reported: 'В публикации сообщается',
  analyst_reviewed: 'Аналитиком проверено в пределах основания',
  analyst_disputed: 'Аналитик отметил как спорное сообщение',
  analyst_rejected: 'Аналитик отклонил сообщение',
  operator_claim: 'Со слов обратившегося',
  not_established: 'В собранной выборке не установлено',
  system_context: 'Контекст',
};

export const lead = (attribution: Attribution): string => LEAD[attribution];

/** Фраза по утверждению: текст с атрибуцией, id утверждения и цитаты его доказательств. */
export const factStatement = (code: string, fact: IFact, body: string, attribution: Attribution = attributionOf(fact)): IStatement => {
  const evidence = fact.evidence.filter(e => e.stance !== 'mentions');
  return {
    code,
    text: `${LEAD[attribution]}: ${body}${fact.needsRevalidation ? ' (основание изменилось — нужен пересмотр)' : ''}.`,
    attribution,
    assertionIds: [fact.assertionId],
    evidenceIds: evidence.map(e => e.id),
    quotes: evidence.slice(0, 3).map(e => ({ evidenceId: e.id, quote: e.quote, sourceTitle: e.sourceTitle, publishedAt: e.publishedAt, stance: e.stance })),
  };
};

export const plainStatement = (code: string, attribution: Attribution, text: string, assertionIds: number[] = [], evidenceIds: number[] = []): IStatement => ({
  code,
  text,
  attribution,
  assertionIds,
  evidenceIds,
  quotes: [],
});

/** Публикации одного текста — одна семья; перепечатки не добавляют независимых подтверждений. */
export const repostNote = (fact: IFact): string => {
  const supports = fact.evidence.filter(e => e.stance === 'supports');
  const items = new Set(supports.map(e => e.sourceItemId)).size;
  const families = new Set(supports.map(e => e.dedupHash)).size;
  if (items <= 1) return '';
  return families < items
    ? `; публикаций ${items}, семей одинакового текста ${families} — перепечатки не считаются независимыми подтверждениями`
    : `; публикаций ${items}`;
};
