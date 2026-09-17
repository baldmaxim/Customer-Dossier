// Краткое досье для переговоров (этап 17, negotiation-brief@1). Строится детерминированно из досье обращения
// (dossier-template@3) — без модели и сети, тем же набором утверждений, что и полное досье и снимок.
//
// Порядок — вокруг вопроса обращения: юрлицо → объект, корпус, работы → заявленная роль → основания роли →
// прямой заказчик → условия (со слов vs из публикации) → противоречия и пробелы → вопросы. Общий фон компании — отдельно
// и никогда не событие выбранной стройки. У каждого пункта видимый статус (не цвет), область действия, дата свежести,
// происхождение публикаций и ссылки на утверждения/доказательства. Итоговой оценки, рейтинга и рекомендаций нет.

import type { ICaseDossier } from './caseDossier.js';
import { scopeNote } from './scope.js';
import type { Attribution, IStatement } from './statements.js';

export const BRIEF_VERSION = 'negotiation-brief@1';

/**
 * Готовность извлечения локальной моделью (RELEASE_READINESS: LOCAL_MODEL_VALIDATED). Меняется только решением по итогам
 * пользовательской оценки, не кодом этапа.
 */
export const LOCAL_MODEL_VALIDATED = false;

export type BriefStatus = Attribution | 'sources_contradict';

export const BRIEF_STATUS_LABEL: Record<BriefStatus, string> = {
  source_reported: 'по публикации',
  analyst_reviewed: 'проверено аналитиком',
  analyst_disputed: 'аналитик: спорно',
  analyst_rejected: 'отклонено аналитиком',
  operator_claim: 'со слов обратившегося',
  not_established: 'не установлено',
  sources_contradict: 'источники противоречат',
  system_context: 'контекст',
};

export type SourceIndependence = 'none' | 'single_publication' | 'reprints_of_one_text' | 'different_texts_origin_unknown';

export const INDEPENDENCE_LABEL: Record<SourceIndependence, string> = {
  none: 'публикаций нет',
  single_publication: 'одна публикация',
  reprints_of_one_text: 'перепечатки одного текста — одно подтверждение',
  different_texts_origin_unknown: 'разные тексты, первоисточник не установлен — независимость не доказана',
};

export interface IBriefItem {
  code: string;
  status: BriefStatus;
  statusLabel: string;
  text: string;
  /** Область действия относительно обращения; null — сопоставление не применялось (запись оператора, пробел). */
  scope: string | null;
  /** Дата самой свежей публикации основания (YYYY-MM-DD); null — оснований-публикаций нет. */
  asOf: string | null;
  sources: { publications: number; textFamilies: number; independence: SourceIndependence; label: string };
  /** Основание изменилось: у публикации есть более новая редакция, не разобранная в это утверждение. */
  pendingRevision: boolean;
  assertionIds: number[];
  evidenceIds: number[];
}

export interface IBriefSection {
  key: string;
  title: string;
  items: IBriefItem[];
  empty: string;
}

export interface INegotiationBrief {
  version: typeof BRIEF_VERSION;
  sections: IBriefSection[];
  /** Общий фон: события компании, другие объекты, договоры без объекта — не относятся к выбранной стройке автоматически. */
  background: IBriefSection;
  questions: ICaseDossier['questions'];
  /** Ограничения данных, видимые в резюме, а не только в админке. */
  dataLimits: string[];
}

const CONTRADICTION_CODES = new Set(['role_denied', 'role_contradicted']);

const independenceOf = (s: IStatement): IBriefItem['sources'] => {
  const publications = s.sources?.publications ?? 0;
  const textFamilies = s.sources?.textFamilies ?? 0;
  const independence: SourceIndependence =
    publications === 0 ? 'none' : publications === 1 ? 'single_publication' : textFamilies <= 1 ? 'reprints_of_one_text' : 'different_texts_origin_unknown';
  const label =
    publications <= 1 ? INDEPENDENCE_LABEL[independence] : `публикаций ${publications}, текстов ${textFamilies}: ${INDEPENDENCE_LABEL[independence]}`;
  return { publications, textFamilies, independence, label };
};

export const briefItem = (s: IStatement): IBriefItem => {
  const status: BriefStatus = CONTRADICTION_CODES.has(s.code) ? 'sources_contradict' : s.attribution;
  const dates = s.quotes.map(q => q.publishedAt).filter((d): d is string => Boolean(d)).sort();
  const note = s.scope ? scopeNote(s.scope).replace(/^ \[|\]$/g, '') : null;
  return {
    code: s.code,
    status,
    statusLabel: BRIEF_STATUS_LABEL[status],
    text: s.text,
    scope: s.scope ? (note && note.length > 0 ? note : 'совпадает с предметом обращения') : null,
    asOf: dates.length > 0 ? dates[dates.length - 1]!.slice(0, 10) : null,
    sources: independenceOf(s),
    pendingRevision: s.pendingRevision === true,
    assertionIds: [...s.assertionIds],
    evidenceIds: [...s.evidenceIds],
  };
};

const summary = (code: string, status: BriefStatus, text: string): IBriefItem => ({
  code,
  status,
  statusLabel: BRIEF_STATUS_LABEL[status],
  text,
  scope: null,
  asOf: null,
  sources: { publications: 0, textFamilies: 0, independence: 'none', label: INDEPENDENCE_LABEL.none },
  pendingRevision: false,
  assertionIds: [],
  evidenceIds: [],
});

const ROLE_SUMMARY: Record<ICaseDossier['role']['status'], [BriefStatus, string]> = {
  reviewed: ['analyst_reviewed', 'Роль компании на объекте проверена аналитиком в пределах основания (ниже).'],
  reported: ['source_reported', 'Роль компании на объекте сообщается в публикациях; аналитиком не проверена.'],
  contradicted: ['sources_contradict', 'Источники противоречат друг другу о роли компании на объекте.'],
  scope_unknown: ['not_established', 'Сведения об участии есть, но для корпуса, работ или периода обращения роль не установлена.'],
  not_established: ['not_established', 'Участие компании в объекте по собранным источникам не установлено.'],
  no_project: ['not_established', 'Объект не выбран — роль не проверялась.'],
  no_company: ['not_established', 'Юрлицо не установлено — роль не проверялась.'],
};

const CHAIN_SUMMARY: Record<ICaseDossier['chain']['status'], [BriefStatus, string]> = {
  documented: ['source_reported', 'Прямой заказчик работ по этому объекту назван в публикации о договоре (ниже). Договор сообщён источником, подписанный документ не проверялся.'],
  differs_from_claim: ['sources_contradict', 'Заказчик в публикациях о договоре не совпадает с заявленным обратившимся.'],
  scope_unknown: ['not_established', 'Прямой заказчик для этого объекта, корпуса и работ не установлен: известные договоры относятся к другому объекту или не называют корпус.'],
  not_documented: ['not_established', 'Прямой заказчик работ не установлен: договоров по объекту в собранных источниках нет. Цепочка не достраивается.'],
  no_project: ['not_established', 'Объект не выбран — заказчик не проверялся.'],
  no_company: ['not_established', 'Юрлицо не установлено — заказчик не проверялся.'],
};

const IDENTITY_GAPS = new Set(['company_unidentified', 'identifiers_missing', 'identity_ambiguous', 'homonyms_exist']);
const OBJECT_GAPS = new Set(['project_unselected', 'building_unspecified', 'work_package_unknown', 'building_differs']);

export const buildNegotiationBrief = (d: ICaseDossier): INegotiationBrief => {
  const items = (list: readonly IStatement[]): IBriefItem[] => list.map(briefItem);
  const subjectBy = (codes: string[]): IStatement[] => d.subject.filter(s => codes.includes(s.code));
  const gaps = (pred: (code: string) => boolean): IStatement[] => d.uncertainties.filter(s => pred(s.code));
  const isLimit = (code: string): boolean => code.startsWith('selection_truncated_') || code === 'signals_stale' || code === 'signals_not_computed' || code === 'review_pending';

  const [roleStatus, roleText] = ROLE_SUMMARY[d.role.status];
  const [chainStatus, chainText] = CHAIN_SUMMARY[d.chain.status];

  const sections: IBriefSection[] = [
    {
      key: 'identity',
      title: 'Кто обратился: юрлицо',
      items: [...items(subjectBy(['company_selected', 'company_unidentified', 'homonyms'])), ...items(gaps(c => IDENTITY_GAPS.has(c)))],
      empty: 'Нет данных.',
    },
    {
      key: 'object',
      title: 'Объект, корпус, работы',
      items: [...items(subjectBy(['project_selected', 'project_unselected'])), ...items(gaps(c => OBJECT_GAPS.has(c)))],
      empty: 'Нет данных.',
    },
    {
      key: 'claimed_role',
      title: 'Заявленная роль',
      items: d.role.claimed ? items([d.role.claimed]) : [summary('claimed_role_absent', 'not_established', 'Роль в обращении не указана.')],
      empty: '',
    },
    {
      key: 'role_basis',
      title: 'Основания роли на этой стройке',
      items: [summary(`role_${d.role.status}`, roleStatus, roleText), ...items(d.role.established), ...items(d.role.otherBuildings)],
      empty: '',
    },
    {
      key: 'direct_client',
      title: 'Прямой заказчик работ',
      items: [...(d.chain.claimed ? items([d.chain.claimed]) : []), summary(`chain_${d.chain.status}`, chainStatus, chainText), ...items(d.chain.documented)],
      empty: '',
    },
    {
      key: 'terms',
      title: 'Условия: со слов обратившегося и из публикаций',
      items: [
        ...(d.terms.claimed ? items([d.terms.claimed]) : []),
        ...(d.terms.fromSources.length > 0 ? items(d.terms.fromSources) : [summary('terms_absent', 'not_established', 'В публикациях условия не найдены; цена, аванс и сроки не рассчитываются и не предполагаются.')]),
      ],
      empty: '',
    },
    {
      key: 'contradictions_gaps',
      title: 'Противоречия и пробелы',
      items: [
        ...items(d.role.contradictions),
        ...items(gaps(c => !IDENTITY_GAPS.has(c) && !OBJECT_GAPS.has(c) && !isLimit(c))),
      ],
      empty: 'Существенных пробелов не выявлено в пределах собранной выборки.',
    },
  ];

  const background: IBriefSection = {
    key: 'background',
    title: 'Общий фон компании — не события выбранной стройки',
    items: [...items(d.companyEvents), ...items(d.chain.context ?? []), ...items(d.role.context ?? []), ...items(d.projectContext.events)],
    empty: 'Фоновых сведений в собранной выборке нет. Это не означает, что их нет.',
  };

  const all = [...sections.flatMap(s => s.items), ...background.items];
  const pending = all.filter(i => i.pendingRevision).length;
  const dataLimits = [
    ...d.uncertainties.filter(s => isLimit(s.code)).map(s => s.text),
    ...(pending > 0 ? [`У ${pending} пунктов есть более новая редакция публикации, ещё не разобранная: вывод по прежнему тексту.`] : []),
    ...(LOCAL_MODEL_VALIDATED
      ? []
      : ['Сообщения публикаций получены автоматическим разбором локальной модели с проверкой цитат; качество разбора не валидировано (LOCAL_MODEL_VALIDATED = нет). Пропуски вероятны; «не установлено» не означает «нет».']),
    'Досье собрано из открытых публикаций и записей оператора: это не проверка контрагента, не оценка надёжности и не юридический или финансовый вывод.',
  ];

  return { version: BRIEF_VERSION, sections, background, questions: d.questions.map(q => ({ ...q })), dataLimits };
};
