// Проверка ответа extract@3 против текста своего чанка. Чистая функция, независимая от генератора.
//
// Три исхода для связи или события:
//  - отброшено (rejected): сторона не подтверждена, вида связи нет для этого типа, стороны нет в цитате;
//  - на проверку (review): текст найден, но смысл противоречит цитате — отрицание при положительном
//    утверждении, план или слух при «состоявшемся факте», договор без признака договора;
//    такое утверждение остаётся кандидатом и не публикуется;
//  - принято: значения, которых нет в собственной цитате, обнулены (дата, сумма, корпус, номер дела).

import { verifyExtraction, isNameInQuote, isQuoteVerbatim, type IVerifiedCompany, type IVerifiedProject } from '../../pipeline/verify.js';
import type { IExtraction } from '../../llm/schema.js';
import { normalizeName } from '../../resolve/normalize.js';
import { KINDS_BY_TYPE, type ISemanticEvent, type ISemanticExtraction, type ISemanticRelation } from '../../llm/semantic/schema.js';
import {
  hasAppealCue,
  hasAwardCue,
  hasBankruptcyCue,
  hasContractCue,
  hasCorporateCue,
  hasOutcomeCue,
  hasParticipationCue,
  modalityConflict,
} from './cues.js';
import {
  groundAmount,
  groundAttribution,
  groundBuilding,
  groundCaseNumber,
  groundPeriod,
  groundTaxBasis,
  groundWorkPackage,
  splitSentences,
  type IGroundedAmount,
  type IGroundedPeriod,
} from './values.js';

const UNVERIFIED_QUOTE_FACTOR = 0.5;

export interface IVerifiedRelation {
  type: ISemanticRelation['type'];
  kind: string;
  subject: string;
  object: string | null;
  project: string | null;
  building: string | null;
  workPackage: string | null;
  workPackageLabel: string | null;
  polarity: ISemanticRelation['polarity'];
  modality: ISemanticRelation['modality'];
  attributedTo: string | null;
  period: IGroundedPeriod;
  quote: string;
  quoteVerified: boolean;
  confidenceFinal: number;
  review: string | null;
}

export interface IVerifiedSemanticEvent {
  type: ISemanticEvent['type'];
  subject: string | null;
  project: string | null;
  building: string | null;
  counterparty: string | null;
  subjectRole: string | null;
  counterpartyRole: string | null;
  caseNumber: string | null;
  stage: string | null;
  outcome: string | null;
  polarity: ISemanticEvent['polarity'];
  modality: ISemanticEvent['modality'];
  attributedTo: string | null;
  period: IGroundedPeriod;
  amount: IGroundedAmount | null;
  amountPurpose: string | null;
  taxBasis: 'with_vat' | 'without_vat' | null;
  quote: string;
  quoteVerified: boolean;
  confidenceFinal: number;
  review: string | null;
}

export interface ISemanticVerification {
  relevant: boolean;
  companies: IVerifiedCompany[];
  projects: IVerifiedProject[];
  relations: IVerifiedRelation[];
  events: IVerifiedSemanticEvent[];
  rejected: Array<{ kind: string; name: string; reason: string }>;
}

/** Компании и объекты проверяются тем же гейтом, что и в extract@2: цитата, имя в цитате, ИНН и город из своей цитаты. */
const verifyEntities = (extraction: ISemanticExtraction, text: string, publishedAt: Date | null) => {
  const legacyShape: IExtraction = {
    doc_relevant: extraction.doc_relevant,
    companies: extraction.companies.map(c => ({ ...c, role: 'unknown', sentiment: 'neutral' })),
    projects: extraction.projects.map(p => ({ ...p, stage: 'unknown' })),
    links: [],
    events: [],
  };
  return verifyExtraction(legacyShape, text, publishedAt);
};

const sameName = (a: string, b: string): boolean => normalizeName(a, 'company').key === normalizeName(b, 'company').key;

const cueReview = (relation: ISemanticRelation): string | null => {
  if (relation.type === 'contract' && !hasContractCue(relation.quote)) return 'в цитате нет признака договора между сторонами';
  if (relation.type === 'corporate' && !hasCorporateCue(relation.kind, relation.quote)) {
    return `в цитате нет признака связи вида ${relation.kind}`;
  }
  if (relation.type === 'participation' && !hasParticipationCue(relation.quote)) return 'в цитате нет признака участия в объекте';
  return null;
};

const verifyRelation = (
  relation: ISemanticRelation,
  text: string,
  publishedAt: Date | null,
  companyNames: ReadonlySet<string>,
  projectNames: ReadonlySet<string>,
  rejected: ISemanticVerification['rejected'],
): IVerifiedRelation | null => {
  const reject = (reason: string): null => {
    rejected.push({ kind: `relation_${relation.type}`, name: relation.subject, reason });
    return null;
  };
  if (!KINDS_BY_TYPE[relation.type].includes(relation.kind)) return reject(`вид «${relation.kind}» не относится к типу ${relation.type}`);
  if (!companyNames.has(relation.subject)) return reject('ссылка на отброшенную компанию');
  if (!isNameInQuote(relation.subject, relation.quote)) return reject(`сторона «${relation.subject}» отсутствует в цитате связи`);

  let object: string | null = null;
  let project: string | null = null;
  if (relation.type === 'participation') {
    // Модель часто кладёт объект в object: это название объекта из того же ответа — не домысел.
    const named = relation.project ?? (relation.object && projectNames.has(relation.object) ? relation.object : null);
    if (!named || !projectNames.has(named)) return reject('ссылка на отброшенный или неуказанный объект');
    if (!isNameInQuote(named, relation.quote)) return reject(`объект «${named}» отсутствует в цитате связи`);
    project = named;
  } else {
    if (!relation.object || !companyNames.has(relation.object)) return reject('вторая сторона не подтверждена');
    if (sameName(relation.subject, relation.object)) return reject('связь компании с самой собой');
    // Прямая связь требует обе стороны в одной цитате: общий ЖК или общая статья — не основание.
    if (!isNameInQuote(relation.object, relation.quote)) return reject(`сторона «${relation.object}» отсутствует в цитате связи`);
    object = relation.object;
    if (relation.project && projectNames.has(relation.project) && isNameInQuote(relation.project, relation.quote)) {
      project = relation.project;
    }
  }

  // Обе стороны в одном предложении: «бренд X. Договор с Y» — не связь X и Y.
  const second = object ?? project!;
  if (!splitSentences(relation.quote).some(s => isNameInQuote(relation.subject, s) && isNameInQuote(second, s))) {
    return reject('стороны связи названы в разных предложениях цитаты');
  }

  const quoteVerified = isQuoteVerbatim(relation.quote, text);
  const wp = groundWorkPackage(relation.work_package, relation.quote);
  return {
    type: relation.type,
    kind: relation.kind,
    subject: relation.subject,
    object,
    project,
    building: groundBuilding(relation.building, relation.quote),
    workPackage: wp.normalized,
    workPackageLabel: wp.label,
    polarity: relation.polarity,
    modality: relation.modality,
    attributedTo: groundAttribution(relation.attributed_to, relation.quote),
    period: groundPeriod(relation.date_from, relation.date_to, relation.date_precision, relation.quote, publishedAt, true),
    quote: relation.quote,
    quoteVerified,
    confidenceFinal: relation.confidence * (quoteVerified ? 1 : UNVERIFIED_QUOTE_FACTOR),
    review: modalityConflict(relation.polarity, relation.modality, relation.quote) ?? cueReview(relation),
  };
};

const verifyEvent = (
  event: ISemanticEvent,
  text: string,
  publishedAt: Date | null,
  companyNames: ReadonlySet<string>,
  projectNames: ReadonlySet<string>,
  rejected: ISemanticVerification['rejected'],
): IVerifiedSemanticEvent | null => {
  const reject = (reason: string): null => {
    rejected.push({ kind: 'event', name: event.type, reason });
    return null;
  };
  const subject = event.subject && companyNames.has(event.subject) ? event.subject : null;
  if (event.subject && !subject) return reject(`сторона «${event.subject}» не подтверждена`);
  if (subject && !isNameInQuote(subject, event.quote)) return reject(`сторона «${subject}» отсутствует в цитате события`);

  const projectKnown = event.project && projectNames.has(event.project) ? event.project : null;
  const project = projectKnown && isNameInQuote(projectKnown, event.quote) ? projectKnown : null;
  if (!subject && !project) return reject('нет подтверждённого участника или объекта в цитате события');

  let counterparty = event.counterparty && companyNames.has(event.counterparty) ? event.counterparty : null;
  if (counterparty && (!isNameInQuote(counterparty, event.quote) || (subject && sameName(subject, counterparty)))) {
    rejected.push({ kind: 'event_counterparty', name: event.type, reason: `контрагент «${counterparty}» отсутствует в цитате события` });
    counterparty = null;
  }

  const reviews: string[] = [];
  const modality = modalityConflict(event.polarity, event.modality, event.quote);
  if (modality) reviews.push(modality);
  if (event.type.startsWith('bankruptcy_') && !hasBankruptcyCue(event.type, event.quote)) {
    reviews.push('стадия банкротства (намерение / заявление / процедура) не подтверждается цитатой');
  }

  const subjectRole = subject ? event.subject_role : null;
  const counterpartyRole = counterparty ? event.counterparty_role : null;
  if (subjectRole && counterpartyRole && subjectRole === counterpartyRole && subjectRole !== 'third_party') {
    reviews.push('у сторон одинаковая процессуальная роль');
  }

  let outcome = event.outcome;
  if (outcome && !hasOutcomeCue(event.quote)) {
    rejected.push({ kind: 'event_outcome', name: event.type, reason: 'результат не написан в цитате события' });
    outcome = null;
  }
  // Обжалование в цитате: решение не окончательное — стадия не «решение», если модель так сказала.
  const stage = event.stage === 'decision' && hasAppealCue(event.quote) ? 'appeal_filed' : event.stage;

  const own = [subject, counterparty].filter((n): n is string => n !== null);
  const others = [...companyNames].filter(n => !own.some(o => sameName(o, n)));
  const amount = groundAmount(event.amount, event.quote, own.length > 0 ? own : project ? [project] : [], others);
  if (event.amount && !amount) {
    rejected.push({ kind: 'event_amount', name: event.type, reason: 'сумма не привязана к сторонам события в его цитате' });
  }
  let amountPurpose = amount ? event.amount_purpose : null;
  // «Присуждено» без решения в цитате — понижается до требования: более слабое утверждение, факт иска не теряется.
  if (amountPurpose === 'award' && !hasAwardCue(event.quote)) {
    rejected.push({ kind: 'event_amount_purpose', name: event.type, reason: 'сумма названа присуждённой, а в цитате нет решения — сохранена как требование' });
    amountPurpose = 'claim';
  }

  const quoteVerified = isQuoteVerbatim(event.quote, text);
  return {
    type: event.type,
    subject,
    project,
    building: groundBuilding(event.building, event.quote),
    counterparty,
    subjectRole,
    counterpartyRole,
    caseNumber: groundCaseNumber(event.case_number, event.quote),
    stage,
    outcome,
    polarity: event.polarity,
    modality: event.modality,
    attributedTo: groundAttribution(event.attributed_to, event.quote),
    period: groundPeriod(event.date_from, event.date_to, event.date_precision, event.quote, publishedAt),
    amount,
    amountPurpose,
    taxBasis: amount ? groundTaxBasis(event.tax_basis, event.quote) : null,
    quote: event.quote,
    quoteVerified,
    confidenceFinal: event.confidence * (quoteVerified ? 1 : UNVERIFIED_QUOTE_FACTOR),
    review: reviews.length > 0 ? reviews.join('; ') : null,
  };
};

export const verifySemanticExtraction = (
  extraction: ISemanticExtraction,
  text: string,
  publishedAt: Date | null,
): ISemanticVerification => {
  const entities = verifyEntities(extraction, text, publishedAt);
  if (!entities.relevant) {
    return { relevant: false, companies: [], projects: [], relations: [], events: [], rejected: entities.rejected };
  }
  const rejected = [...entities.rejected];
  const companyNames = new Set(entities.companies.map(c => c.name));
  const projectNames = new Set(entities.projects.map(p => p.name));

  const relations = extraction.relations
    .map(r => verifyRelation(r, text, publishedAt, companyNames, projectNames, rejected))
    .filter((r): r is IVerifiedRelation => r !== null);
  const events = extraction.events
    .map(e => verifyEvent(e, text, publishedAt, companyNames, projectNames, rejected))
    .filter((e): e is IVerifiedSemanticEvent => e !== null);

  return { relevant: true, companies: entities.companies, projects: entities.projects, relations, events, rejected };
};
