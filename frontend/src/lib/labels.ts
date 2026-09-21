// Русские подписи для машинных значений + форматирование.
// Одно место: иначе «general_contractor» превращается в «генподрядчик» на одном
// экране и в «Генеральный подрядчик» на другом.

import type {
  AssertionStatus,
  PermissionStatus,
  Role,
  Sentiment,
  TextCompleteness,
} from '../api/types';

/** Полнота текста: «полный» — только при положительном признаке, не по длине. */
export const COMPLETENESS_LABELS: Record<TextCompleteness, string> = {
  full: 'полный текст',
  excerpt: 'анонс',
  caption_only: 'подпись к вложению',
  failed: 'не получен',
  unknown: 'полнота неизвестна',
};

/** Статус утверждения: «найдено в тексте» и «подтверждено аналитиком» — разные вещи. */
export const ASSERTION_STATUS_LABELS: Record<AssertionStatus, string> = {
  candidate: 'кандидат',
  text_grounded: 'есть в тексте источника',
  reviewed_supported: 'подтверждено аналитиком',
  disputed: 'спорно',
  rejected: 'отклонено',
};

export const REVIEW_SCOPE_LABELS: Record<string, string> = {
  reflects_source: 'источник действительно так пишет',
  fact_confirmed: 'факт подтверждён независимо',
};

export const STANCE_LABELS: Record<string, string> = {
  supports: 'подтверждает',
  contradicts: 'опровергает',
  mentions: 'упоминает',
};

export const MODALITY_LABELS: Record<string, string> = {
  reported_fact: 'сообщается как факт',
  claim: 'заявление стороны',
  planned: 'план',
  possible: 'возможно',
  negated: 'отрицание',
  unknown: 'модальность неизвестна',
};

/** Роль на объекте, вид договора и корпоративной связи в утверждениях (этап 06). */
export const ASSERTION_ROLE_LABELS: Record<string, string> = {
  customer: 'заказчик',
  general_contractor: 'генподрядчик',
  contractor: 'подрядчик',
  subcontractor: 'субподрядчик',
  supplier: 'поставщик',
  designer: 'проектировщик',
  investor: 'инвестор',
  operator: 'эксплуатация',
  // Застройщик по 214-ФЗ — не подрядная роль: приходит из реестра, модель её не выбирает.
  developer: 'застройщик',
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

export const POLARITY_LABELS: Record<string, string> = {
  positive: 'утверждается',
  negative: 'отрицается',
};

export const PRECISION_LABELS: Record<string, string> = {
  day: 'точная дата',
  month: 'с точностью до месяца',
  quarter: 'с точностью до квартала',
  year: 'с точностью до года',
  unknown: 'дата неизвестна',
};

export const PROCEDURAL_ROLE_LABELS: Record<string, string> = {
  plaintiff: 'истец',
  defendant: 'ответчик',
  applicant: 'заявитель',
  creditor: 'кредитор',
  debtor: 'должник',
  third_party: 'третье лицо',
};

export const EVENT_STAGE_LABELS: Record<string, string> = {
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

export const EVENT_OUTCOME_LABELS: Record<string, string> = {
  satisfied: 'удовлетворено',
  partially_satisfied: 'удовлетворено частично',
  dismissed: 'отказано',
  overturned: 'отменено',
  settled: 'урегулировано',
};

export const AMOUNT_PURPOSE_LABELS: Record<string, string> = {
  claim: 'требование',
  award: 'присуждено',
  contract: 'цена договора',
  debt: 'долг по сообщению',
  penalty: 'неустойка',
  other: 'сумма',
  amount: 'сумма',
};

export const REVIEW_QUEUE_LABELS: Record<string, string> = {
  identity: 'неоднозначная идентичность',
  polarity_conflict: 'утверждение и отрицание',
  role_period_conflict: 'конфликт ролей в одном периоде',
  correction: 'основание изменилось',
  dispute: 'оспаривается',
};

export const CHRONOLOGY_LABELS: Record<string, string> = {
  source_modified_at: 'по дате изменения от источника',
  observed_order: 'по порядку наблюдения',
  unknown: 'порядок неизвестен',
};

export const PERMISSION_LABELS: Record<PermissionStatus, string> = {
  unknown: 'не подтверждён',
  approved: 'разрешён',
  blocked: 'запрещён',
  revoked: 'отозван',
  expired: 'истёк',
};

export const ROLE_LABELS: Record<Role, string> = {
  customer: 'Заказчик',
  general_contractor: 'Генподрядчик',
  contractor: 'Подрядчик',
  designer: 'Проектировщик',
  investor: 'Инвестор',
  operator: 'Эксплуатация',
};

/** Тональность упоминания. Подпись словом обязательна: одного цвета мало. */
export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: 'позитив',
  neutral: 'нейтрально',
  negative: 'негатив',
};

export const STAGE_LABELS: Record<string, string> = {
  announced: 'Анонсирован',
  design: 'Проектирование',
  construction: 'Строится',
  suspended: 'Приостановлен',
  commissioned: 'Сдан',
  cancelled: 'Отменён',
  unknown: 'Стадия неизвестна',
};

export const KIND_LABELS: Record<string, string> = {
  residential: 'Жильё',
  office: 'Офисы',
  industrial: 'Промышленность',
  infrastructure: 'Инфраструктура',
  social: 'Соцобъект',
  other: 'Прочее',
};

export const EVENT_LABELS: Record<string, string> = {
  construction_start: 'Начало строительства',
  milestone: 'Этап работ',
  delay: 'Задержка',
  deadline_missed: 'Срыв срока',
  court_case: 'Судебное дело',
  contractor_change: 'Смена подрядчика',
  commissioning: 'Ввод в эксплуатацию',
  bankruptcy: 'Банкротство',
  bankruptcy_intent: 'Намерение о банкротстве',
  bankruptcy_filing: 'Заявление о банкротстве',
  bankruptcy_procedure: 'Процедура банкротства',
  payment_claim: 'Претензия об оплате',
  suspension: 'Приостановка работ',
  resumption: 'Возобновление работ',
  cancellation: 'Отмена проекта',
  license_revoked: 'Отзыв лицензии',
  tender_award: 'Победа в тендере',
  other: 'Прочее',
};

export const SOURCE_KIND_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  website: 'Сайт',
  manual: 'Вручную',
};

export const formatDate = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const formatDateTime = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Суммы в стройке бывают в миллиардах — полное число нечитаемо. */
export const formatMoney = (amount: number): string => {
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(1)} млрд ₽`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(1)} млн ₽`;
  return `${amount.toLocaleString('ru-RU')} ₽`;
};

export const formatPercent = (share: number | null): string =>
  share === null ? '—' : `${Math.round(share * 100)} %`;

/** Вид сущности компании (этап 04). */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  legal_entity: 'юрлицо',
  brand: 'бренд',
  group: 'группа компаний',
  unknown: 'вид не установлен',
};

export const IDENTIFIER_TYPE_LABELS: Record<string, string> = {
  inn: 'ИНН',
  ogrn: 'ОГРН',
  ogrnip: 'ОГРНИП',
  kpp: 'КПП',
  bin: 'БИН',
  other: 'реквизит',
};

export const RELATION_LABELS: Record<string, { outgoing: string; incoming: string }> = {
  brand_of: { outgoing: 'бренд компании', incoming: 'владеет брендом' },
  member_of_group: { outgoing: 'входит в группу', incoming: 'группа включает' },
  successor_of: { outgoing: 'правопреемник', incoming: 'предшественник компании' },
};

export const PROJECT_LEVEL_LABELS: Record<string, string> = {
  complex: 'комплекс',
  phase: 'очередь',
  building: 'корпус',
};

/** Что переносит слияние — подписи счётчиков предпросмотра. */
export const MERGE_COUNT_LABELS: Record<string, string> = {
  aliases: 'написаний',
  aliasDuplicates: 'совпавших написаний',
  mentions: 'упоминаний',
  events: 'событий (legacy)',
  participants: 'ролей на объектах (legacy)',
  participantDuplicates: 'совпавших ролей',
  identifiers: 'реквизитов',
  relations: 'связей',
  children: 'очередей и корпусов',
  assertions: 'утверждений',
  activeEvidence: 'активных оснований',
  pendingQueuePairs: 'других пар в очереди',
  priorMerges: 'прежних слияний сторон',
};

/** Здоровье источника (этап 05A). */
export const SOURCE_HEALTH_LABELS: Record<string, string> = {
  unknown: 'не проверялся',
  ok: 'в порядке',
  parser_degraded: 'вёрстка изменилась?',
  rate_limited: 'ограничение частоты (429)',
  blocked: 'доступ закрыт',
  error: 'ошибка',
  config_invalid: 'профиль некорректен',
  identity_uncertain: 'канал не совпадает с источником',
};

export const RUN_OUTCOME_LABELS: Record<string, string> = {
  ok: 'успешно',
  not_modified: 'без изменений (304)',
  partial: 'частично',
  parser_degraded: 'селекторы не нашли записи',
  rate_limited: 'ограничение частоты',
  blocked: 'отказ доступа',
  http_error: 'ошибка HTTP',
  network: 'сеть недоступна',
  oversize: 'ответ слишком большой',
  config_invalid: 'профиль некорректен',
  error: 'ошибка',
  policy_blocked: 'допуск отозван во время прохода',
  identity_changed: 'другой канал на странице',
  not_found: 'канал не найден',
  private: 'канал закрыт',
};

export const COVERAGE_STOP_LABELS: Record<string, string> = {
  exhausted: 'пройдены все страницы',
  caught_up: 'догнали уже сохранённое',
  max_pages: 'лимит страниц — история не полная',
  max_items: 'лимит записей — история не полная',
  failed: 'остановлено сбоем',
  not_modified: 'страница не менялась',
  parser_degraded: 'остановлено: вёрстка',
  feed_window: 'окно ленты — история не гарантируется',
  empty_feed: 'лента пуста',
  up_to_date: 'новые посты сохранены',
  history_not_collected: 'история канала не собиралась',
  channel_start_reached: 'дошли до начала канала',
  gap_open_max_pages: 'разрыв постов ещё не догружен',
  gap_closed: 'разрыв постов догружен',
  policy_blocked: 'остановлено: допуск отозван',
  identity_changed: 'остановлено: другой канал',
};

// ─── Сигналы (этап 07) ────────────────────────────────────────────────────

export const IDENTITY_STATUS_LABELS: Record<string, string> = {
  identified: 'реквизит с верной контрольной суммой',
  identifier_unverified: 'реквизит не проверен',
  name_only: 'только название, реквизитов нет',
  ambiguous: 'идентичность под вопросом',
};

export const REVIEW_LEVEL_LABELS: Record<string, string> = {
  reviewed: 'проверено аналитиком',
  text_grounded: 'есть в тексте, не проверено',
  legacy_unreviewed: 'из старого разбора, не проверено',
  disputed: 'спорно',
  rejected: 'отклонено аналитиком',
};

export const DATE_STATUS_LABELS: Record<string, string> = {
  in_window: 'в окне 12 месяцев',
  boundary: 'на границе окна (неточная дата)',
  before_window: 'раньше окна',
  future: 'дата позже среза',
  undated: 'дата события неизвестна',
};

export const OVERLAP_LABELS: Record<string, string> = {
  overlaps: 'периоды пересекаются',
  no_overlap: 'периоды не пересекаются',
  unknown: 'пересечение неизвестно',
};

export const CONTEXT_STATE_LABELS: Record<string, string> = {
  construction: 'строится',
  suspended: 'приостановлен',
  cancelled: 'отменён',
  commissioned: 'введён',
};

// ─── Рабочее досье (этап 08A) ────────────────────────────────────────────

export const ATTRIBUTION_LABELS: Record<string, string> = {
  source_reported: 'в публикации сообщается',
  analyst_reviewed: 'проверено аналитиком',
  analyst_disputed: 'спорно по решению аналитика',
  analyst_rejected: 'отклонено аналитиком',
  operator_claim: 'со слов обратившегося',
  not_established: 'не установлено в выборке',
  system_context: 'контекст',
};

export const CASE_ROLE_STATUS_LABELS: Record<string, string> = {
  reviewed: 'подтверждена аналитиком в пределах основания',
  reported: 'сообщается в публикациях, не проверена',
  // Противоречие источников и решение аналитика — разные оси: решение по утверждению не снимает отрицание из другой публикации.
  contradicted: 'источники противоречат — противоречие сохраняется и после решения аналитика (решение указано у утверждения)',
  scope_unknown: 'сведения есть, но корпус, работы или период не указаны или другие — для обращения не установлена',
  not_established: 'по источникам не установлена',
  no_project: 'объект не выбран',
  no_company: 'юрлицо не установлено',
};

export const CASE_CHAIN_STATUS_LABELS: Record<string, string> = {
  documented: 'договор с заказчиком документирован',
  differs_from_claim: 'в источниках другой заказчик, чем заявлено',
  scope_unknown: 'прямой договор по этому объекту, корпусу и работам не установлен; есть договоры вне предмета обращения',
  not_documented: 'договорная цепочка не установлена',
  no_project: 'объект не выбран',
  no_company: 'юрлицо не установлено',
};

export const REVIEW_QUEUE_KIND_LABELS: Record<string, string> = {
  identity: 'нерешённая идентификация',
  polarity_conflict: 'противоречие источников',
  role_period_conflict: 'конфликт ролей в одном периоде',
  correction: 'изменилась доказательная база',
  dispute: 'оспаривается',
};

export const IN_PERIOD_LABELS: Record<string, string> = {
  overlaps: 'в выбранном периоде',
  no_overlap: 'вне выбранного периода',
  unknown: 'период участия не указан',
  no_period_selected: '',
};

export const CLAIMED_ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'customer', label: 'заказчик' },
  { value: 'general_contractor', label: 'генподрядчик' },
  { value: 'contractor', label: 'подрядчик' },
  { value: 'subcontractor', label: 'субподрядчик' },
  { value: 'supplier', label: 'поставщик' },
  { value: 'designer', label: 'проектировщик' },
  { value: 'investor', label: 'инвестор' },
  { value: 'operator', label: 'эксплуатация' },
];

/** Типы рёбер схемы связей (этап 08B). Различаются подписью и штрихом линии, не цветом надёжности. */
export const GRAPH_EDGE_LABELS: Record<string, string> = {
  participation: 'участие в объекте',
  contract: 'договор (сообщён источником)',
  corporate: 'корпоративная связь',
  hierarchy: 'входит в объект',
  co_mentioned: 'совместное упоминание',
};

/** Этап 15A: решение по одному неоднозначному упоминанию — не слияние и не проверка утверждения. */
export const AMBIGUITY_DECISION_LABELS: Record<string, string> = {
  resolved_to: 'в этом тексте — выбранный кандидат',
  kept_unknown: 'оставлено неустановленным',
  dismissed: 'не упоминание компании/объекта',
};

export const AMBIGUITY_STATUS_LABELS: Record<string, string> = {
  open: 'не разобрано',
  resolved: 'решено',
  dismissed: 'отклонено',
};

/** Этап 15B: статусы запусков, чанков, ответов и кандидатов. */
export const RUN_STATUS_LABELS: Record<string, string> = {
  queued: 'в очереди',
  running: 'выполняется',
  completed: 'разобран полностью',
  partial: 'разобран частично',
  failed: 'не разобран',
  cancelled: 'отменён',
};

export const CHUNK_OUTCOME_LABELS: Record<string, string> = {
  ok: 'ответ принят',
  invalid_json: 'невалидный JSON',
  schema_error: 'ответ не по схеме',
  llm_error: 'ошибка модели или соединения',
  timeout: 'тайм-аут',
  truncated_input: 'ответ обрезан',
};

export const CANDIDATE_VERDICT_LABELS: Record<string, string> = {
  publishable: 'пройдёт в карточки',
  review: 'найден в тексте, но отправлен на проверку',
  ungrounded: 'цитата не найдена — в карточки не попадёт',
};

export const CANDIDATE_SET_STATUS_LABELS: Record<string, string> = {
  built: 'собран, в карточки не попал',
  published: 'в карточках',
  superseded: 'замещён новым набором',
  rejected_policy: 'отклонён: нет допуска',
  rejected_stale: 'отклонён: устарел',
  discarded: 'отброшен',
};

/** Этап 16: состояние источника (source-health@1) — словами, не цветом. */
export const SOURCE_HEALTH_STATE_LABELS: Record<string, string> = {
  never_run: 'не запускался',
  healthy: 'работает',
  degraded: 'разбор деградировал',
  policy_blocked: 'доступ закрыт',
  temporary_error: 'временная ошибка',
  partial_history: 'неполная история',
};

/** Исход сохранения текста, вставленного вручную (`StoreOutcome` бэкенда). */
export const MANUAL_OUTCOME_LABELS: Record<string, string> = {
  inserted: 'текст сохранён как новая публикация',
  duplicate: 'такой текст уже есть в базе — вставка учтена как ещё одно появление',
  new_revision: 'это правка уже известной публикации — сохранена новая редакция',
  unchanged: 'этот текст уже вставлялся, изменений нет',
  stale: 'в базе есть более поздняя редакция этой публикации',
  too_short: 'текст слишком короткий — не сохранён',
  edited_skipped: 'публикация известна с другим текстом, а запись редакций выключена — правка не сохранена',
};

/**
 * Что портал сделал с текстом публикации. Причины пустоты разные, и смешивать их нельзя:
 * «не о стройке» — это решение модели, «нет допуска» — решение оператора, «не разбирался» —
 * отсутствие данных.
 */
export const ITEM_STATE_LABELS: Record<string, string> = {
  in_cards: 'разобрано, сведения в карточках',
  nothing_found: 'разобрано, связей в тексте не найдено',
  not_relevant: 'текст признан не относящимся к стройке и недвижимости',
  built_not_in_cards: 'разобрано, в карточки ещё не перенесено',
  queued: 'ждёт разбора',
  running: 'разбирается',
  partial: 'разобрано частично — в карточки не идёт',
  failed: 'разобрать не удалось',
  cancelled: 'разбор отменён',
  no_policy: 'у источника нет допуска на ИИ-обработку — текст не разбирался',
  no_run: 'ещё не разбирался',
};

export const ITEM_STATE_HINTS: Record<string, string> = {
  in_cards: 'утверждения из этого текста подтверждаются его цитатами и видны в карточках компаний и объектов',
  nothing_found: 'текст про стройку, но связей, которые портал умеет извлекать, в нём нет',
  not_relevant: 'модель не нашла в тексте строительной темы; в карточки такой текст не идёт',
  built_not_in_cards: 'набор кандидатов собран, но перенос в карточки не состоялся — причина видна в запуске',
  partial: 'часть текста осталась неразобранной; неполный разбор в карточки не идёт ни при каком флаге',
  no_policy: 'допуск на ИИ-обработку ставит оператор с основанием; без него текст модели не показывают',
  no_run: 'портал ставит разбор сам; если источник допущен, это произойдёт в ближайшем проходе',
};

/**
 * Вид утверждения (extract@3). Без словаря на экран запуска уходили сырые
 * `company_mentioned` и `project_mentioned` — оператор читал машинный ключ.
 */
export const PREDICATE_LABELS: Record<string, string> = {
  participates_in_project: 'участие в объекте',
  contract: 'прямой договор',
  corporate_relation: 'корпоративная связь',
  event: 'событие',
  company_mentioned: 'упоминание компании',
  project_mentioned: 'упоминание объекта',
};

/** Пояснения к видам утверждений: чем участие отличается от договора. */
export const PREDICATE_HINTS: Record<string, string> = {
  participates_in_project:
    'источник называет компанию участником объекта в определённой роли; договор этим не подтверждается',
  contract: 'источник прямо говорит о договоре между двумя сторонами; подписанный документ не проверялся',
  corporate_relation: 'владение, дочерняя компания, группа — по тексту источника',
  event: 'происшествие, суд, срыв срока или иное событие с датой из цитаты',
  company_mentioned: 'в тексте названа компания; участие и договор этим не подтверждаются',
  project_mentioned: 'в тексте назван объект; чьё это участие — отдельный вопрос',
};

/** Состояние чанка разбора. Раньше три значения печатались тернарником мимо словаря. */
export const CHUNK_STATUS_LABELS: Record<string, string> = {
  ok: 'принят',
  failed: 'не разобран',
  pending: 'ожидает',
  running: 'разбирается',
};

/** Операционный статус источника: только расписание опроса, не допуск. */
export const SOURCE_STATUS_LABELS: Record<string, string> = {
  active: 'активен',
  paused: 'пауза',
  broken: 'сломан',
};

/** Состояние сырого документа в очереди разбора. */
export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  queued: 'ждут разбора',
  extracting: 'разбираются',
  extracted: 'разобраны',
  failed: 'разбор не удался',
  skipped: 'признаны нерелевантными',
};
