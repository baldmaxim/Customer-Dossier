// Русские подписи для машинных значений + форматирование.
// Одно место: иначе «general_contractor» превращается в «генподрядчик» на одном
// экране и в «Генеральный подрядчик» на другом.

import type {
  AssertionStatus,
  PermissionStatus,
  RiskLight,
  Role,
  Sentiment,
  TextCompleteness,
} from '../api/types';

/**
 * Старый светофор — эвристический индекс по новостям (веса 40/30/30 не
 * калиброваны). Он не оценивает надёжность контрагента, а отсутствие новостей
 * не означает отсутствия проблем. Подписи это говорят прямо.
 */
export const RISK_LEGACY_LABELS: Record<RiskLight, string> = {
  grey: 'Мало данных',
  green: 'Сигналов не найдено',
  yellow: 'Есть сигналы',
  red: 'Много сигналов',
};

export const RISK_LEGACY_NOTE =
  'Устаревший эвристический индекс по публикациям, не оценка надёжности. ' +
  'Отсутствие сигналов в выборке не означает отсутствия проблем.';

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
