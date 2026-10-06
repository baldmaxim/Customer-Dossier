// Русские подписи для машинных значений + форматирование.
// Одно место: иначе «general_contractor» превращается в «генподрядчик» на одном
// экране и в «Генеральный подрядчик» на другом.
//
// Слова — оператора, а не конвейера: «сведение», а не «утверждение»; «цитата», а не
// «доказательство»; «разбор», а не «запуск»; «часть текста», а не «чанк»; «источник
// включён», а не «ИИ-допуск»; «возможный дубль», а не «пара на слияние». Имён переменных
// окружения, миграций и команд здесь нет: подпись говорит, что происходит, а как это
// настраивается — дело настроек сервера.

import type {
  AccessPermission,
  AssertionStatus,
  FocusRequestOutcome,
  FocusStopReason,
  FocusTargetProblem,
  IFocusRequestRow,
  LlmKeyProblem,
  LlmKeySource,
  LlmProvider,
  CourtCaseType,
  DeliveryShiftDirection,
  CourtRole,
  FinanceLine,
  NewsKind,
  ParserApiConnectionState,
  ParserApiDataset,
  ParserApiMethod,
  ParserApiRequestOutcome,
  DomRfCandidateState,
  DomRfCardKind,
  DomRfHintVerdict,
  DomRfCompanyLinkState,
  DomRfFoundBy,
  Role,
  SiteCandidateState,
  SiteCheckStatus,
  SiteFoundVia,
  SiteProjectStatus,
  SiteSearchMode,
  SiteSearchOutcome,
  TextCompleteness,
  UserRole,
} from '../api/types';

/** Полнота текста: «полный» — только при положительном признаке, не по длине. */
export const COMPLETENESS_LABELS: Record<TextCompleteness, string> = {
  full: 'полный текст',
  excerpt: 'анонс',
  caption_only: 'подпись к вложению',
  failed: 'текст не получен',
  unknown: 'полнота неизвестна',
};

/** Статус сведения: «найдено в тексте» и «подтверждено оператором» — разные вещи. */
export const ASSERTION_STATUS_LABELS: Record<AssertionStatus, string> = {
  // Модель нашла, но цитата не сверена или сведение отправлено на проверку — это ещё не факт.
  candidate: 'найдено, не проверено',
  text_grounded: 'есть в тексте источника',
  reviewed_supported: 'подтверждено оператором',
  disputed: 'спорно',
  rejected: 'отклонено',
};

export const REVIEW_SCOPE_LABELS: Record<string, string> = {
  reflects_source: 'источник действительно так пишет',
  fact_confirmed: 'факт подтверждён независимо',
};

/** Как цитата относится к сведению. */
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
  unknown: 'не ясно: факт или план',
};

/**
 * Роль компании на объекте — одна таблица слов на весь портал. Со строчной буквы: подпись
 * стоит и в ярлыке, и внутри фразы («генподрядчик · ЖК …»).
 */
const PARTICIPANT_ROLE_WORDS = {
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
} as const;

/** Роль на объекте, вид договора и корпоративной связи в сведениях (этап 06). */
export const ASSERTION_ROLE_LABELS: Record<string, string> = {
  ...PARTICIPANT_ROLE_WORDS,
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

/**
 * Те же слова, что в ASSERTION_ROLE_LABELS, но строго по типу `Role` (роль из списка объектов).
 * Раньше здесь было «Заказчик» с заглавной, и одна строка сводки писала роль то так, то этак.
 */
export const ROLE_LABELS: Record<Role, string> = {
  customer: PARTICIPANT_ROLE_WORDS.customer,
  general_contractor: PARTICIPANT_ROLE_WORDS.general_contractor,
  contractor: PARTICIPANT_ROLE_WORDS.contractor,
  designer: PARTICIPANT_ROLE_WORDS.designer,
  investor: PARTICIPANT_ROLE_WORDS.investor,
  operator: PARTICIPANT_ROLE_WORDS.operator,
};

/**
 * Стадия объекта — одни слова для списка объектов (`projects.stage`) и для состояния по дате
 * события (CONTEXT_STATE_LABELS): раньше один и тот же ввод в эксплуатацию был «Сдан» в одном
 * месте и «введён» в другом. Со строчной буквы — как роли, рядом с которыми стоит ярлык.
 */
const PROJECT_STAGE_WORDS = {
  announced: 'анонсирован',
  design: 'проектируется',
  construction: 'строится',
  suspended: 'приостановлен',
  commissioned: 'сдан',
  cancelled: 'отменён',
} as const;

export const STAGE_LABELS: Record<string, string> = {
  ...PROJECT_STAGE_WORDS,
  unknown: 'стадия неизвестна',
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

/**
 * Вид источника — подпись у поста и в списках. Сайт без ссылки на оригинал подписывался
 * «вставлено вручную», хотя его собрал обходчик: вид берётся отсюда, а не из тернарника.
 */
export const SOURCE_KIND_LABELS: Record<string, string> = {
  telegram: 'Telegram-канал',
  website: 'сайт',
  manual: 'ручная вставка',
};

export const formatDate = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/**
 * Дата поста для лент: «23 сентября» — крупно, год только если не текущий. Время — отдельно
 * (`formatTime`): в ленте дата важнее, а «10:17» читается как пометка рядом.
 */
export const formatPostDate = (iso: string | null, now: Date = new Date()): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
};

export const formatTime = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Как назвать источник на экране. У Telegram-каналов имя собирается со страницы канала
 * при сборе; пока его нет, `title` равен ключу («propertyinsider») — тогда показываем
 * «@propertyinsider», как это пишет сам Telegram, а не голый технический ключ.
 */
export const sourceLabel = (source: { sourceTitle: string; sourceKey?: string | null; sourceKind: string }): string =>
  source.sourceKind === 'telegram' && source.sourceKey && source.sourceTitle === source.sourceKey
    ? `@${source.sourceKey}`
    : source.sourceTitle;

/** Где остановился сбор истории в последнем проходе (coverage.stopReason), когда задан срок сбора. */
export const HISTORY_STOP_LABELS: Record<string, string> = {
  history_in_progress: 'история догружается',
  history_depth_reached: 'собрано за весь срок',
  channel_start_reached: 'собрано с начала канала',
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

// ─── Деньги и доли ──────────────────────────────────────────────────────────
// Русский вид: запятая в дробях, пробел между разрядами («38,1 млн ₽»). Между числом и единицей —
// неразрывный пробел: в узкой колонке «млн ₽» не уезжает на новую строку. Счётчики
// («12 345», «3 публикации») — formatCount и formatCountWord в format.ts.

const NBSP = '\u00a0';
const SCALED_FORMAT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const EXACT_MONEY_FORMAT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const PERCENT_FORMAT = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 });

/** Суммы в стройке бывают в миллиардах — полное число нечитаемо. От миллиона — порядком. */
const MONEY_SCALE: ReadonlyArray<{ divisor: number; unit: string }> = [
  { divisor: 1e12, unit: 'трлн' },
  { divisor: 1e9, unit: 'млрд' },
  { divisor: 1e6, unit: 'млн' },
];

const CURRENCY_SIGNS: Record<string, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  KZT: '₸',
};

const scaledAmount = (value: number): string => {
  const step = MONEY_SCALE.find(s => Math.abs(value) >= s.divisor);
  if (!step) return EXACT_MONEY_FORMAT.format(value);
  const shown = Math.round((value / step.divisor) * 10) / 10;
  // 999,96 млн после округления — «1000 млн»: это уже следующий порядок.
  const bigger = MONEY_SCALE[MONEY_SCALE.indexOf(step) - 1];
  if (bigger && Math.abs(shown) >= 1000) {
    return `${SCALED_FORMAT.format(Math.round((value / bigger.divisor) * 10) / 10)}${NBSP}${bigger.unit}`;
  }
  return `${SCALED_FORMAT.format(shown)}${NBSP}${step.unit}`;
};

/**
 * Сумма: «38,1 млн ₽», «1,2 млрд ₽», «950 000 ₽». Сервер отдаёт суммы и строкой
 * («38100000.00») — её можно передать как есть. Валюты не пересчитываются (ADR-008):
 * сумма в долларах остаётся в долларах, а если валюту источник не назвал, так и сказано —
 * рубль не подставляется.
 */
export const formatMoney = (amount: number | string, currency: string | null = 'RUB'): string => {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '—';
  const code = currency?.trim().toUpperCase() || null;
  const unit = code === null ? '(валюта не указана)' : (CURRENCY_SIGNS[code] ?? code);
  return `${scaledAmount(value)}${NBSP}${unit}`;
};

/** Доля: «83 %». Неизвестное — прочерк. */
export const formatPercent = (share: number | null): string =>
  share === null || !Number.isFinite(share) ? '—' : PERCENT_FORMAT.format(share);

/** Месяцы — словарём, а не Intl: тот пишет «март 2026 г.», а в подписи графика «г.» лишнее. */
export const MONTH_LABELS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
] as const;
export const MONTH_SHORT_LABELS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const;

/** Месяц ряда «2026-03» → «март 2026»; неразборчивое — как есть. */
export const formatMonth = (key: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  const name = m ? MONTH_LABELS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : key;
};

/** Происхождение текста (семьи перепечаток, signals): порядок — от известного первоисточника к неизвестному. */
export const FAMILY_ORIGIN_LABELS: Record<'established' | 'named' | 'unknown', string> = {
  established: 'первоисточник в выборке',
  named: 'первоисточник назван, его публикации нет',
  unknown: 'первоисточник неизвестен',
};

/** Роль компании в делах (signals courtRoles): истец/заявитель/кредитор — одна группа, ответчик/должник — другая. */
export const COURT_ROLE_GROUP_LABELS: Record<'plaintiff' | 'defendant' | 'other' | 'unknown', string> = {
  plaintiff: 'истец, заявитель или кредитор',
  defendant: 'ответчик или должник',
  other: 'другая роль',
  unknown: 'роль не названа',
};

/** Вид компании (этап 04). */
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

/**
 * Реквизит словами: «ИНН 7801234567». Сервер присылает тип с юрисдикцией («RU:inn») —
 * на экран уходил сырой ключ и склейка без пробела.
 */
export const formatIdentifier = ({ type, value }: { type: string; value: string }): string => {
  const bare = type.includes(':') ? type.slice(type.lastIndexOf(':') + 1) : type;
  return `${IDENTIFIER_TYPE_LABELS[bare] ?? IDENTIFIER_TYPE_LABELS.other} ${value}`;
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

/** Что переносит объединение дублей — подписи счётчиков при сравнении двух карточек. */
export const MERGE_COUNT_LABELS: Record<string, string> = {
  aliases: 'вариантов написания',
  aliasDuplicates: 'совпавших вариантов написания',
  mentions: 'упоминаний',
  events: 'событий (прежняя обработка)',
  participants: 'ролей на объектах (прежняя обработка)',
  participantDuplicates: 'совпавших ролей',
  identifiers: 'реквизитов',
  relations: 'связей',
  children: 'очередей и корпусов',
  assertions: 'сведений',
  activeEvidence: 'цитат',
  pendingQueuePairs: 'других возможных дублей',
  priorMerges: 'прежних объединений',
};

/** Как работает сборщик по последним проходам (этап 05A). */
export const SOURCE_HEALTH_LABELS: Record<string, string> = {
  unknown: 'не проверялся',
  ok: 'в порядке',
  parser_degraded: 'похоже, изменилась вёрстка',
  rate_limited: 'сайт просит реже',
  blocked: 'доступ закрыт',
  error: 'ошибка сбора',
  config_invalid: 'ошибка в настройке сайта',
  identity_uncertain: 'канал не совпадает с источником',
};

/** Итог одного прохода сборщика: «ничего нового» и «не смогли прочитать» — разные исходы. */
export const RUN_OUTCOME_LABELS: Record<string, string> = {
  ok: 'успешно',
  not_modified: 'без изменений',
  partial: 'собрано частично',
  parser_degraded: 'вёрстка изменилась — записи не найдены',
  rate_limited: 'сайт просит реже',
  blocked: 'сайт закрыл доступ',
  http_error: 'сайт ответил ошибкой',
  network: 'сеть недоступна',
  oversize: 'страница слишком большая',
  config_invalid: 'ошибка в настройке сайта',
  error: 'ошибка сбора',
  policy_blocked: 'источник выключили во время сбора',
  identity_changed: 'на странице другой канал',
  not_found: 'канал не найден',
  private: 'канал закрыт',
};

/** Где и почему остановился проход сборщика. */
export const COVERAGE_STOP_LABELS: Record<string, string> = {
  exhausted: 'пройдены все страницы',
  caught_up: 'дошли до уже собранного',
  max_pages: 'лимит страниц — собрано не всё',
  max_items: 'лимит записей — собрано не всё',
  failed: 'остановлено сбоем',
  not_modified: 'страница не менялась',
  parser_degraded: 'остановлено: изменилась вёрстка',
  feed_window: 'лента отдаёт только последние записи',
  empty_feed: 'лента пуста',
  up_to_date: 'новые посты сохранены',
  history_not_collected: 'старые посты не собирались',
  channel_start_reached: 'дошли до начала канала',
  gap_open_max_pages: 'пропуск в постах ещё не догружен',
  gap_closed: 'пропуск в постах догружен',
  policy_blocked: 'остановлено: источник выключен',
  identity_changed: 'остановлено: на странице другой канал',
  history_in_progress: 'история догружается по сроку сбора',
  history_depth_reached: 'история собрана за весь срок',
  pagination_loop: 'остановлено: страницы архива повторяются',
};

// ─── Показатели компании (этап 07) ──────────────────────────────────────────

/** Опознание компании. Верный номер ИНН/ОГРН — это «без опечаток», а не проверка в реестре. */
export const IDENTITY_STATUS_LABELS: Record<string, string> = {
  identified: 'ИНН/ОГРН указан, номер без ошибок',
  identifier_unverified: 'ИНН/ОГРН указан, номер не проверен',
  name_only: 'только название, без ИНН и ОГРН',
  ambiguous: 'опознание под вопросом: есть возможные дубли или неясные упоминания',
};

export const REVIEW_LEVEL_LABELS: Record<string, string> = {
  reviewed: 'проверено оператором',
  text_grounded: 'есть в тексте, не проверено',
  legacy_unreviewed: 'из прежней обработки, не проверено',
  disputed: 'спорно',
  rejected: 'отклонено оператором',
};

/** Дата события относительно окна «последние 12 месяцев» от даты расчёта показателей. */
export const DATE_STATUS_LABELS: Record<string, string> = {
  in_window: 'за последние 12 месяцев',
  boundary: 'около границы 12 месяцев (дата неточная)',
  before_window: 'больше 12 месяцев назад',
  future: 'позже даты расчёта',
  undated: 'дата события неизвестна',
};

/** Совпадает ли событие объекта с периодом участия компании. Совпадение — контекст, а не вина. */
export const OVERLAP_LABELS: Record<string, string> = {
  overlaps: 'в период участия компании',
  no_overlap: 'вне периода участия компании',
  unknown: 'совпадение с участием неизвестно',
};

/** Состояние объекта по дате события — те же слова, что у стадии объекта. */
export const CONTEXT_STATE_LABELS: Record<string, string> = {
  construction: PROJECT_STAGE_WORDS.construction,
  suspended: PROJECT_STAGE_WORDS.suspended,
  cancelled: PROJECT_STAGE_WORDS.cancelled,
  commissioned: PROJECT_STAGE_WORDS.commissioned,
};

// ─── Откуда известно ────────────────────────────────────────────────────────

/** Кто стоит за фразой сводки — словами, а не цветом. */
export const ATTRIBUTION_LABELS: Record<string, string> = {
  source_reported: 'в публикации сообщается',
  analyst_reviewed: 'проверено оператором',
  analyst_disputed: 'спорно по решению оператора',
  analyst_rejected: 'отклонено оператором',
  not_established: 'в собранных публикациях не найдено',
  // Фразу составил сам портал (опознание, полнота, свежесть расчёта), а не взял из текста.
  system_context: 'пояснение портала',
};

/** Вид вопроса в «Проверке». */
export const REVIEW_QUEUE_KIND_LABELS: Record<string, string> = {
  identity: 'неясное упоминание',
  polarity_conflict: 'противоречие источников',
  role_period_conflict: 'две компании в одной роли одновременно',
  correction: 'цитаты изменились после решения',
  dispute: 'оспаривается',
};

export const IN_PERIOD_LABELS: Record<string, string> = {
  overlaps: 'в выбранном периоде',
  no_overlap: 'вне выбранного периода',
  unknown: 'период участия не указан',
  no_period_selected: '',
};

/**
 * На каком основании компания считается контрагентом (этап 22). Совместное участие —
 * не договор: две фирмы на одном объекте могут не иметь отношений между собой.
 */
/** «Кто строит для компании» (24D): откуда известно и как найдена карточка портала. */
export const BUILDER_SOURCE_LABELS: Record<string, string> = {
  registry: 'ДОМ.РФ',
  publications: 'публикации',
};

export const BUILDER_MATCH_LABELS: Record<string, string> = {
  identifier: 'найдена по ИНН из ДОМ.РФ',
  name: 'совпало по названию — проверьте ИНН',
};

export const PARTNER_KIND_LABELS: Record<string, string> = {
  contract: 'договор',
  corporate: 'корпоративная связь',
  co_participation: 'вместе на объекте',
};

export const PARTNER_KIND_HINTS: Record<string, string> = {
  contract: 'обе стороны названы в одном предложении источника как стороны договора',
  corporate: 'доля, контроль, группа или бренд — по сообщению источника',
  co_participation: 'обе компании работают на одном объекте. Это не договор между ними и не значит, что они связаны',
};

/** Типы линий схемы связей (этап 08B). Различаются подписью и штрихом линии, не цветом надёжности. */
export const GRAPH_EDGE_LABELS: Record<string, string> = {
  participation: 'участие в объекте',
  contract: 'договор (сообщён источником)',
  corporate: 'корпоративная связь',
  hierarchy: 'входит в объект',
  co_mentioned: 'совместное упоминание',
};

/** Решение по одному неясному упоминанию — не объединение карточек и не проверка сведения (этап 15A). */
export const AMBIGUITY_DECISION_LABELS: Record<string, string> = {
  resolved_to: 'опознано',
  kept_unknown: 'оставлено неясным',
  dismissed: 'не компания и не объект',
};

export const AMBIGUITY_STATUS_LABELS: Record<string, string> = {
  open: 'ждёт решения',
  resolved: 'решено',
  dismissed: 'не компания и не объект',
};

// ─── Обработка: разбор текстов моделью (этап 15B) ───────────────────────────

/** Статус одного разбора текста. */
export const RUN_STATUS_LABELS: Record<string, string> = {
  queued: 'в очереди',
  running: 'выполняется',
  completed: 'выполнен полностью',
  partial: 'выполнен частично',
  failed: 'не удался',
  cancelled: 'отменён',
};

/** Ответ модели на одну часть текста. */
export const CHUNK_OUTCOME_LABELS: Record<string, string> = {
  ok: 'ответ принят',
  invalid_json: 'модель ответила не по формату',
  schema_error: 'модель ответила не теми полями',
  llm_error: 'ошибка модели или соединения',
  timeout: 'модель не ответила вовремя',
  truncated_input: 'ответ обрезан',
};

/** Что будет с одним найденным в тексте сведением. */
export const CANDIDATE_VERDICT_LABELS: Record<string, string> = {
  publishable: 'попадёт в карточки',
  review: 'есть в тексте, нужна проверка',
  ungrounded: 'цитаты нет в тексте — в карточки не попадёт',
};

/** Что стало с найденным в тексте: перенесено ли в карточки, а если нет — почему. */
export const CANDIDATE_SET_STATUS_LABELS: Record<string, string> = {
  built: 'разобран, не перенесён',
  published: 'в карточках',
  superseded: 'заменён более новым разбором',
  rejected_policy: 'не перенесён: источник выключен',
  rejected_stale: 'не перенесён: текст изменился',
  discarded: 'отброшен',
};

/** Журнал переноса в карточки: те же слова, что у CANDIDATE_SET_STATUS_LABELS. */
export const PUBLICATION_ACTION_LABELS: Record<string, string> = {
  publish: 'перенесён в карточки',
  rejected_policy: 'не перенесён: источник выключен',
  rejected_stale: 'не перенесён: текст изменился',
};

export const PUBLICATION_ACTION_HINTS: Record<string, string> = {
  publish: 'сведения из текста добавлены в карточки компаний и объектов',
  rejected_policy: 'источник был выключен — найденное перенесётся после его включения',
  rejected_stale: 'текст изменился после разбора — портал разберёт новую версию сам',
};

/** Состояние источника для оператора (source-health@1) — словами, не цветом. */
export const SOURCE_HEALTH_STATE_LABELS: Record<string, string> = {
  never_run: 'ещё не собирался',
  healthy: 'работает',
  degraded: 'сбор работает с ошибками',
  policy_blocked: 'выключен',
  temporary_error: 'временный сбой',
  partial_history: 'собрана не вся история',
};

/** Исход сохранения текста, вставленного вручную (`StoreOutcome` бэкенда). */
export const MANUAL_OUTCOME_LABELS: Record<string, string> = {
  inserted: 'текст сохранён как новая публикация',
  duplicate: 'такой текст уже есть в базе',
  new_revision: 'это правка уже известной публикации — сохранена новая версия текста',
  unchanged: 'этот текст уже вставлялся, изменений нет',
  stale: 'в базе уже есть более новая версия этой публикации',
  too_short: 'текст слишком короткий — не сохранён',
  edited_skipped: 'публикация известна с другим текстом, а новые версии не сохраняются — правка не сохранена',
};

/**
 * Что стало с текстом публикации — итог коротко (`/api/items/:id/extraction`; те же слова годятся
 * для колонки «Итог» в «Обработке»). Причины пустоты разные, и смешивать их нельзя: «не о стройке» —
 * решение модели, «источник выключен» — решение оператора, «ещё не разбирался» — отсутствие данных.
 */
export const ITEM_STATE_LABELS: Record<string, string> = {
  in_cards: 'в карточках',
  nothing_found: 'связей не найдено',
  not_relevant: 'не о стройке',
  built_not_in_cards: 'разобран, не перенесён',
  queued: 'в очереди на разбор',
  running: 'разбирается',
  partial: 'разобран частично',
  failed: 'разбор не удался',
  cancelled: 'разбор отменён: источник выключен',
  no_policy: 'источник выключен',
  no_run: 'ещё не разбирался',
};

export const ITEM_STATE_HINTS: Record<string, string> = {
  in_cards: 'сведения из этого текста видны в карточках компаний и объектов — у каждого есть цитата',
  nothing_found: 'текст о стройке, но связей между компаниями и объектами в нём нет',
  not_relevant: 'модель не нашла в тексте строительной темы — в карточки такой текст не идёт',
  built_not_in_cards: 'текст разобран, но в карточки не перенесён — причина видна в разборе',
  partial: 'часть текста не разобрана; неполный разбор в карточки не идёт — если повтор включён, портал повторит его сам',
  failed: 'разбор прервался ошибкой (чаще всего модель не ответила); если повтор включён, портал повторит его сам',
  cancelled: 'источник выключили во время разбора; такой разбор портал сам не повторяет',
  no_policy: 'пока источник выключен, его тексты модели не показывают',
  no_run: 'портал разберёт текст сам в ближайшем проходе, если источник включён',
};

/**
 * Вид сведения (extract@3). Без словаря на экран разбора уходили сырые
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

/** Пояснения к видам сведений: чем участие отличается от договора. */
export const PREDICATE_HINTS: Record<string, string> = {
  participates_in_project:
    'источник называет компанию участником объекта в определённой роли; договор этим не подтверждается',
  contract: 'источник прямо говорит о договоре между двумя сторонами; подписанный документ не проверялся',
  corporate_relation: 'владение, дочерняя компания, группа — по тексту источника',
  event: 'происшествие, суд, срыв срока или иное событие с датой из цитаты',
  company_mentioned: 'в тексте названа компания; участие и договор этим не подтверждаются',
  project_mentioned: 'в тексте назван объект; чьё это участие — отдельный вопрос',
};

/** Состояние одной части текста в разборе. Раньше три значения печатались тернарником мимо словаря. */
export const CHUNK_STATUS_LABELS: Record<string, string> = {
  ok: 'разобрана',
  failed: 'не разобрана',
  pending: 'ждёт разбора',
  running: 'разбирается',
};

/**
 * Где сейчас текст и почему его нет в карточках (этап 22) — по последним версиям текстов.
 * Каждое состояние — ответ на вопрос оператора, а не внутреннее слово конвейера; слова те же,
 * что в ITEM_STATE_LABELS.
 */
export const REVISION_STATE_LABELS: Record<string, string> = {
  published: 'в карточках',
  completed_unpublished: 'разобран, не перенесён',
  irrelevant: 'не о стройке',
  in_queue: 'в очереди на разбор',
  waiting: 'ещё не разбирался',
  no_ai_permission: 'источник выключен',
  failed_retrying: 'разбор не удался, будет повтор',
  failed_exhausted: 'разбор не удался, попытки исчерпаны',
  cancelled: 'разбор отменён: источник выключен',
  unknown: 'состояние неизвестно',
};

// ─── Пользователи и права (ADR-014) ──────────────────────────────────────────

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'администратор',
  operator: 'оператор',
  viewer: 'читатель',
};

export const USER_ROLE_HINTS: Record<UserRole, string> = {
  admin: 'всё, что может оператор, плюс пользователи, права, журнал входа, ключи модели, Контур.Фокуса и parser-api.com',
  operator: 'портал и админка: источники, обработка, проверка и объединение дублей',
  viewer: 'только поиск, карточки компаний и объектов, публикации и связи',
};

export const ACCESS_PERMISSION_LABELS: Record<AccessPermission, string> = {
  'portal.read': 'Поиск, карточки, публикации, связи',
  'admin.view': 'Админка: источники, обработка, проверка (просмотр)',
  'sources.manage': 'Источники: добавить, включить, срок сбора, ручная вставка',
  // Кнопок для этого в интерфейсе нет: обработка идёт сама, право нужно для восстановления после сбоя.
  'pipeline.manage': 'Перезапуск разбора и пересчёт показателей после сбоя',
  'review.decide': 'Проверка: решения по сведениям, цитатам, упоминаниям и реквизитам',
  'entities.merge': 'Проверка: объединение дублей и его отмена',
  'dossier.view': 'Обращения и снимки: смотреть (раздел снят)',
  'dossier.manage': 'Обращения и снимки: изменять (раздел снят)',
  'users.manage': 'Пользователи, права и журнал входа',
  'llm.manage': 'Модель: ключ OpenRouter',
  'focus.manage': 'Контур.Фокус: ключ доступа',
  'parserapi.manage': 'parser-api.com: ключ доступа',
  'companies.manage': 'Компании: завести по ИНН, поставить на контроль',
};

/**
 * Права, которых экран не показывает: разделы обращений и снимков сняты (21.09.2026), а сервер
 * эти права по-прежнему выдаёт. Из типа они не удалены — иначе ответ сервера разошёлся бы с типом.
 */
export const HIDDEN_PERMISSIONS: ReadonlySet<AccessPermission> = new Set<AccessPermission>(['dossier.view', 'dossier.manage']);

/** Права для показа в профиле и таблице ролей — без снятых разделов. */
export const visiblePermissions = (permissions: readonly AccessPermission[]): AccessPermission[] =>
  permissions.filter(p => !HIDDEN_PERMISSIONS.has(p));

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  lmstudio: 'LM Studio — модель на своём компьютере',
  openrouter: 'OpenRouter — модель в облаке',
};

export const LLM_KEY_SOURCE_LABELS: Record<LlmKeySource, string> = {
  admin: 'задан в админке',
  env: 'из настроек сервера',
  none: 'не задан',
};

/** Технические подробности — только в подсказке: экран «Модель» видит лишь админка. */
export const LLM_KEY_SOURCE_HINTS: Record<LlmKeySource, string> = {
  admin: 'хранится в базе зашифрованным; на экран возвращаются только четыре последних символа',
  env: 'LLM_API_KEY в .env сервера; ключ, заданный в админке, главнее',
  none: 'без ключа разбор через OpenRouter ждёт; собранное не теряется',
};

export const LLM_KEY_PROBLEM_LABELS: Record<LlmKeyProblem, string> = {
  store_missing: 'Хранилище ключей на сервере не подготовлено: пока действует только ключ из настроек сервера.',
  undecryptable: 'Сохранённый ключ не читается: на сервере сменили пароль базы данных. Задайте ключ заново.',
};

export const LLM_KEY_PROBLEM_HINTS: Record<LlmKeyProblem, string> = {
  store_missing: 'не применена миграция 032 (таблица app_secrets); до этого действует LLM_API_KEY из .env',
  undecryptable: 'ключ шифруется от пароля из DATABASE_URL: после смены пароля старый ключ не расшифровать',
};

/** Технические подробности ключа Фокуса — только в подсказке администратору. */
export const FOCUS_KEY_SOURCE_HINTS: Record<LlmKeySource, string> = {
  admin: 'хранится в базе зашифрованным; на экран возвращаются только четыре последних символа',
  env: 'FOCUS_API_KEY в .env сервера; ключ, заданный в админке, главнее',
  none: 'без ключа портал не обращается к Контур.Фокусу вовсе',
};

export const FOCUS_KEY_PROBLEM_HINTS: Record<LlmKeyProblem, string> = {
  store_missing: 'не применена миграция 032 (таблица app_secrets); до этого действует FOCUS_API_KEY из .env',
  undecryptable: 'ключ шифруется от пароля из DATABASE_URL: после смены пароля старый ключ не расшифровать',
};

export const FOCUS_TARGET_PROBLEM_LABELS: Record<FocusTargetProblem, string> = {
  no_identifier: 'У компании нет ИНН или ОГРН — Контур.Фокус ищет только по реквизитам.',
  several_identifiers: 'У компании несколько разных ИНН или ОГРН — пока не ясно, какой её, сведения не запрашиваются.',
};

/** Чем кончился запрос Фокуса при заведении компании по ИНН (ADR-016) — фраза для тоста. */
export const REGISTER_FOCUS_LABELS: Record<'found' | 'not_found' | 'already_checked' | 'failed' | FocusStopReason, string> = {
  found: 'Сведения ЕГРЮЛ получены из Контур.Фокуса.',
  not_found: 'Контур.Фокус не знает компанию с этим реквизитом — проверьте цифры.',
  already_checked: 'Сведения ЕГРЮЛ уже были получены раньше.',
  failed: 'Контур.Фокус не ответил — сведения придут с обновлением по расписанию.',
  no_key: 'Контур.Фокус не подключён — наименование и сведения ЕГРЮЛ появятся, когда администратор задаст ключ.',
  limit: 'Суточный лимит запросов к Контур.Фокусу исчерпан — сведения придут позже.',
  key_rejected: 'Контур.Фокус не принял ключ — его нужно заменить в админке.',
  quota_exhausted: 'Тариф Контур.Фокуса исчерпан.',
  rate_limited: 'Контур.Фокус просит обращаться реже — сведения придут позже.',
};

/** Вердикт модели по паре «возможный дубль» (entity-match@1) — подпись кандидата в назначении имени. */
export const MODEL_VERDICT_HINTS: Record<'same' | 'different' | 'unsure', string> = {
  same: 'модель: скорее та же компания',
  different: 'модель: скорее другая компания',
  unsure: 'модель: не уверена',
};

export const FOCUS_METHOD_LABELS: Record<IFocusRequestRow['method'], string> = {
  req: 'реквизиты и статус',
  egrDetails: 'деятельность и учредители',
  stat: 'проверка ключа',
  suggest: 'поиск по названию',
};

export const FOCUS_REQUEST_OUTCOME_LABELS: Record<FocusRequestOutcome, string> = {
  ok: 'ответ получен',
  key_rejected: 'ключ не принят',
  method_forbidden: 'не входит в тариф',
  quota_exhausted: 'тариф исчерпан',
  rate_limited: 'слишком часто',
  bad_response: 'непонятный ответ',
  http_error: 'ошибка Фокуса',
  network: 'нет связи',
};

/** parser-api.com (этап 24A): наборы, методы журнала, исходы запросов. */
export const PARSER_API_DATASET_LABELS: Record<ParserApiDataset, string> = {
  finance: 'бухгалтерская отчётность (ГИР БО)',
  tax: 'налоги и численность («Прозрачный бизнес»)',
  courts: 'арбитражные дела',
  fssp: 'исполнительные производства (ФССП)',
  bankruptcy: 'банкротство (Федресурс)',
};

export const PARSER_API_METHOD_LABELS: Record<ParserApiMethod, string> = {
  bo_search: 'ГИР БО: поиск',
  bo_details: 'ГИР БО: отчётность',
  pb_org: '«Прозрачный бизнес»',
  kad_search: 'картотека дел',
  fssp_ur: 'ФССП',
  fedresurs_ur: 'Федресурс: поиск',
  fedresurs_org: 'Федресурс: карточка',
  key_check: 'проверка ключа',
};

export const PARSER_API_OUTCOME_LABELS: Record<ParserApiRequestOutcome, string> = {
  pending: 'идёт запрос',
  ok: 'ответ получен',
  key_rejected: 'ключ не принят',
  subscription_expired: 'подписка истекла',
  ip_rejected: 'адрес портала не разрешён',
  daily_limit: 'суточный лимит сервиса',
  monthly_limit: 'месячный лимит сервиса',
  bad_request: 'отказ по параметрам',
  bad_response: 'непонятный ответ',
  http_error: 'ошибка сервиса',
  network: 'нет связи',
};

export const PARSER_API_CONNECTION_LABELS: Record<ParserApiConnectionState, string> = {
  none: 'не подключён',
  unverified: 'ключ задан, ждёт первого ответа',
  connected: 'подключён',
  key_rejected: 'ключ не принят',
  subscription_expired: 'подписка истекла',
  ip_rejected: 'адрес портала не разрешён',
};

/** Строки отчётности ГИР БО в карточке (24B): подпись — как в отчёте, коротко. */
export const FINANCE_LINE_LABELS: Record<FinanceLine, string> = {
  revenue: 'Выручка',
  salesProfit: 'Прибыль от продаж',
  pretaxProfit: 'Прибыль до налогообложения',
  netProfit: 'Чистая прибыль (убыток)',
  interestPayable: 'Проценты к уплате',
  assets: 'Активы',
  equity: 'Капитал',
  longBorrowings: 'Займы долгосрочные',
  shortBorrowings: 'Займы краткосрочные',
  payables: 'Кредиторская задолженность',
  receivables: 'Дебиторская задолженность',
  cash: 'Денежные средства',
};

/**
 * Состояние набора сведений parser-api.com словами (24B, 24C). not_checked — не спрашивали; failed — последняя
 * попытка не удалась. «Записей нет» — ответ сервиса, а не отсутствие проверки.
 */
export const PARSER_API_STATE_LABELS: Record<'not_checked' | 'found' | 'not_found' | 'partial' | 'failed', string> = {
  not_checked: 'не запрашивалось',
  found: 'сведения получены',
  not_found: 'записей нет',
  partial: 'получена часть',
  failed: 'запрос не удался',
};

/** Картотека арбитражных дел (24C): роль компании в деле и вид дела. */
export const COURT_ROLE_LABELS: Record<CourtRole, string> = {
  respondent: 'ответчик',
  plaintiff: 'истец',
  third: 'третье лицо',
  other: 'иной участник',
  unknown: 'роль не указана',
};

export const COURT_TYPE_LABELS: Record<CourtCaseType, string> = {
  economic: 'экономический спор',
  administrative: 'административное',
  bankruptcy: 'о банкротстве',
  unknown: 'вид не указан',
};

/** Перенос срока сдачи между снимками ДОМ.РФ (24E): в какую сторону. */
export const SHIFT_DIRECTION_LABELS: Record<DeliveryShiftDirection, string> = {
  later: 'позже',
  earlier: 'раньше',
  unknown: 'сдвиг не распознан',
};

export const HOUSE_FORMS = ['дом', 'дома', 'домов'] as const;
/** «по 1 дому», «по 2 домам», «по 5 домам». */
export const HOUSE_DATIVE_FORMS = ['дому', 'домам', 'домам'] as const;
export const APARTMENT_FORMS = ['квартира', 'квартиры', 'квартир'] as const;

/** «Новое» (24F): вид новости. */
export const NEWS_KIND_LABELS: Record<NewsKind, string> = {
  new_project: 'новый объект',
  deadline_shift: 'срок сдачи',
  court_case: 'арбитраж',
  fssp: 'ФССП',
};

type INewsSourceKind = 'publication' | 'registry' | 'kad' | 'fssp';

export const NEWS_SOURCE_LABELS: Record<INewsSourceKind, string> = {
  publication: 'публикация',
  registry: 'ДОМ.РФ',
  kad: 'картотека дел',
  fssp: 'ФССП',
};

export const PARSER_API_KEY_SOURCE_HINTS: Record<LlmKeySource, string> = {
  admin: 'хранится в базе зашифрованным; на экран возвращаются только четыре последних символа',
  env: 'PARSER_API_KEY в .env сервера; ключ, заданный в админке, главнее',
  none: 'без ключа портал не обращается к parser-api.com вовсе',
};

export const PARSER_API_KEY_PROBLEM_HINTS: Record<LlmKeyProblem, string> = {
  store_missing: 'не применена миграция 032 (таблица app_secrets); до этого действует PARSER_API_KEY из .env',
  undecryptable: 'ключ шифруется от пароля из DATABASE_URL: после смены пароля старый ключ не расшифровать',
};

export const DOMRF_CANDIDATE_STATE_LABELS: Record<DomRfCandidateState, string> = {
  pending: 'ждёт решения',
  confirmed: 'подтверждён — в сборе',
  rejected: 'отклонён',
  replaced: 'заменён другой карточкой',
};

export const DOMRF_COMPANY_LINK_STATE_LABELS: Record<DomRfCompanyLinkState, string> = {
  pending: 'предложено',
  confirmed: 'это он',
  rejected: 'не он',
};

export const DOMRF_FOUND_BY_LABELS: Record<DomRfFoundBy, string> = {
  inn: 'по ИНН',
  name: 'по названию',
  manual: 'указано вручную',
};

// Сайты компаний (этап 25A): проверка кандидата, решение оператора, откуда взят, итог поиска.
export const SITE_CHECK_STATUS_LABELS: Record<SiteCheckStatus, string> = {
  not_checked: 'ещё не проверен',
  ok: 'открывается',
  unreachable: 'не открывается',
  blocked: 'закрыт для портала',
  redirect_other_host: 'ведёт на другой сайт',
  js_only: 'показывается только в браузере',
  not_html: 'не страница сайта',
};

export const SITE_CANDIDATE_STATE_LABELS: Record<SiteCandidateState, string> = {
  pending: 'ждёт решения',
  confirmed: 'сайт компании',
  rejected: 'не он',
};

export const SITE_FOUND_VIA_LABELS: Record<SiteFoundVia, string> = {
  web_search: 'найден поиском',
  operator: 'указан вручную',
};

export const SITE_SEARCH_OUTCOME_LABELS: Record<SiteSearchOutcome, string> = {
  found: 'найдены кандидаты',
  none: 'сайта не нашлось',
  no_citations: 'поиск ничего не вернул',
};

/** Статус проекта со слов сайта компании (25B), со строчной — стоит ярлыком. */
export const SITE_PROJECT_STATUS_LABELS: Record<SiteProjectStatus, string> = {
  selling: 'в продаже',
  construction: 'строится',
  completed: 'сдан',
  planned: 'планируется',
  unknown: 'статус не указан',
};

export const SITE_SEARCH_MODE_LABELS: Record<SiteSearchMode, string> = {
  off: 'поиск сайтов выключен',
  needs_openrouter: 'поиск сайтов включён, но модель не OpenRouter — искать нечем',
  on: 'поиск сайтов идёт в фоне',
};

/** Подсказка модели — со строчной: стоит после «Модель:». */
export const DOMRF_HINT_VERDICT_LABELS: Record<DomRfHintVerdict, string> = {
  match: 'скорее он',
  no_match: 'скорее не он',
  unsure: 'не уверена',
};

export const DOMRF_CARD_KIND_LABELS: Record<DomRfCardKind, string> = {
  developer: 'Застройщик',
  group: 'Группа компаний',
};

export const AUTH_EVENT_LABELS: Record<string, string> = {
  login_succeeded: 'вход',
  login_failed: 'неудачный вход',
  logout: 'выход',
  password_changed: 'пароль сменён',
  password_reset: 'пароль сброшен',
  user_created: 'пользователь создан',
  user_updated: 'пользователь изменён',
  user_disabled: 'доступ выключен',
  user_enabled: 'доступ включён',
  session_revoked: 'вход закрыт',
  registration_requested: 'заявка на доступ',
  registration_approved: 'заявка одобрена',
  registration_rejected: 'заявка отклонена',
  passkey_added: 'ключ доступа добавлен',
  passkey_removed: 'ключ доступа убран',
};

/**
 * Почему вход не удался — видно только администратору; пользователь слышит одно и то же
 * «неверный логин или пароль». Исключение — заявка: о ней человек узнаёт после верного пароля.
 */
export const LOGIN_FAILURE_LABELS: Record<string, string> = {
  unknown_login: 'нет такого логина',
  bad_password: 'неверный пароль',
  locked: 'вход временно закрыт',
  disabled: 'доступ выключен',
  registration_pending: 'заявка ещё не одобрена',
  registration_rejected: 'заявка отклонена',
  passkey_unknown: 'ключа доступа нет на портале',
  passkey_invalid: 'ключ доступа не прошёл проверку',
};

/** Отказ во входе по заявке — экран входа объясняет словами (сервер отвечает так только на верный пароль). */
export const LOGIN_REFUSAL_LABELS: Record<string, { title: string; text: string }> = {
  registration_pending: {
    title: 'Заявка ещё не одобрена',
    text: 'Администратор портала пока не рассмотрел заявку на доступ. Войти получится сразу после одобрения — отправлять заявку заново не нужно.',
  },
  registration_rejected: {
    title: 'Заявка отклонена',
    text: 'Администратор портала отклонил заявку на доступ. Если это ошибка — свяжитесь с ним.',
  },
};

/** Ключ доступа живёт на одном устройстве или синхронизируется (iCloud Keychain, Google, менеджер паролей). */
export const PASSKEY_DEVICE_LABELS: Record<string, string> = {
  multiDevice: 'синхронизируется между устройствами',
  singleDevice: 'только на этом устройстве',
};

/** Кто действовал, если не пользователь портала. */
export const AUTH_ACTOR_LABELS: Record<string, string> = {
  cli: 'консоль сервера',
  anonymous: '—',
  operator: 'локальный оператор',
};

/** Вердикт модели по паре «возможный дубль» (entity-match@1, 02.10.2026). */
export const MODEL_VERDICT_LABELS: Record<string, string> = {
  same: 'модель: это одно и то же',
  different: 'модель: это разные',
  unsure: 'модель: не уверена',
};

/** Почему пара «возможный дубль» в очереди, если не по сходству строк: проход по звучанию (resolve/soundPairs.ts). */
export const MERGE_REASON_LABELS: Record<string, string> = {
  sound_key: 'звучит одинаково',
};

/** Кто принял решение: модель подписывается своим именем («model:…»), правило сбора — «auto». */
export const actorLabel = (actor: string | null | undefined): string => {
  if (!actor) return '—';
  if (actor.startsWith('model:')) return `модель (${actor.slice('model:'.length)})`;
  if (actor === 'auto') return 'автоматически';
  return actor;
};
