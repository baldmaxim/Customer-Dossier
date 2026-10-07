// Машинный статус → тон подсветки. Один словарь на весь портал: раньше «выключено оператором»
// на одном экране было красным, на другом серым, а «не запускался» — жёлтым.
//
// Тон — только подсветка, смысл несёт подпись из labels.ts: цвет один нечитаем при дальтонизме.
// Итоговой оценки и светофора «по риску» здесь нет и не будет (ADR-009): тон говорит о состоянии
// сбора, разбора или решения, а не о том, хороша ли компания.
//
//   success — сделано, всё в порядке;
//   info    — идёт или сведение для оператора; вмешиваться не нужно;
//   warning — стоит посмотреть: не перенесено, временный сбой, ждёт решения;
//   danger  — сбой, который без вмешательства не пройдёт;
//   neutral — данных ещё нет или это решение оператора («выключено») — не поломка.

import type { AmbiguityStatus, AssertionStatus, ISourceHealthState, ItemState, ParserApiConnectionState, RunStatus, SourceHealth } from '../api/types';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Тон значения, которого может не оказаться в словаре (сервер прислал новое): нейтральный, а не тревожный. */
export const toneOf = (tones: Readonly<Record<string, StatusTone>>, value: string | null | undefined): StatusTone =>
  (value === null || value === undefined ? undefined : tones[value]) ?? 'neutral';

/** Состояние источника для оператора (source-health@1). */
export const SOURCE_HEALTH_STATE_TONE: Record<ISourceHealthState['state'], StatusTone> = {
  healthy: 'success',
  // Попыток сбора ещё не было — это отсутствие данных, а не предупреждение.
  never_run: 'neutral',
  // Выключено оператором — решение, а не поломка.
  policy_blocked: 'neutral',
  degraded: 'warning',
  temporary_error: 'warning',
  // Старые посты собраны не все — сведение о полноте, а не сбой.
  partial_history: 'info',
};

/** Подключение внешнего сервиса (parser-api.com, этап 24A): зелёный — только после настоящего ответа. */
export const PARSER_API_CONNECTION_TONE: Record<ParserApiConnectionState, StatusTone> = {
  connected: 'success',
  // Ключа нет — решение владельца, а не поломка.
  none: 'neutral',
  // Ключ задан, подтвердит первый запрос.
  unverified: 'info',
  key_rejected: 'danger',
  subscription_expired: 'danger',
  ip_rejected: 'danger',
};

/** Как работает сборщик по последним проходам (этап 05A). */
export const SOURCE_HEALTH_TONE: Record<SourceHealth, StatusTone> = {
  ok: 'success',
  unknown: 'neutral',
  parser_degraded: 'warning',
  // Сайт просит реже — пройдёт само после паузы.
  rate_limited: 'warning',
  identity_uncertain: 'warning',
  blocked: 'danger',
  error: 'danger',
  // Ошибка в настройке сайта сама не исправится.
  config_invalid: 'danger',
};

/** Статус одного разбора текста моделью (этап 15B). */
export const RUN_STATUS_TONE: Record<RunStatus, StatusTone> = {
  queued: 'neutral',
  running: 'info',
  completed: 'success',
  // Неполный разбор в карточки не идёт; при включённом повторе портал повторит его сам.
  partial: 'warning',
  // Упавший разбор портал повторяет сам: авария — только когда попытки исчерпаны (REVISION_STATE_TONE).
  failed: 'warning',
  // Отмена — это выключенный источник, решение оператора.
  cancelled: 'neutral',
};

/** Что стало с найденным в тексте (набор кандидатов). */
export const CANDIDATE_SET_STATUS_TONE: Record<string, StatusTone> = {
  published: 'success',
  // Разобран, но не перенесён — ровно то, что оператор приходит выяснить в «Обработку».
  built: 'warning',
  superseded: 'neutral',
  rejected_policy: 'neutral',
  // Текст изменился после разбора — портал разберёт новую версию сам.
  rejected_stale: 'info',
  discarded: 'neutral',
};

/** Что будет с одним найденным сведением. */
export const CANDIDATE_VERDICT_TONE: Record<string, StatusTone> = {
  publishable: 'success',
  review: 'warning',
  // Отсев без цитаты — штатная защита от выдумки модели, а не сбой.
  ungrounded: 'neutral',
};

/** Журнал переноса в карточки. */
export const PUBLICATION_ACTION_TONE: Record<string, StatusTone> = {
  publish: 'success',
  rejected_policy: 'neutral',
  rejected_stale: 'info',
};

/** Где текст сейчас — по последним версиям текстов (этап 22). */
export const REVISION_STATE_TONE: Record<string, StatusTone> = {
  published: 'success',
  completed_unpublished: 'warning',
  // «Не о стройке» — решение модели о тексте, а не сбой.
  irrelevant: 'neutral',
  in_queue: 'neutral',
  waiting: 'neutral',
  no_ai_permission: 'neutral',
  failed_retrying: 'warning',
  // Попытки исчерпаны: сам этот текст в карточки уже не пойдёт.
  failed_exhausted: 'danger',
  cancelled: 'neutral',
  unknown: 'neutral',
};

/** Итог по тексту (колонка «Итог» в «Обработке»). */
export const ITEM_STATE_TONE: Record<ItemState, StatusTone> = {
  in_cards: 'success',
  nothing_found: 'neutral',
  not_relevant: 'neutral',
  built_not_in_cards: 'warning',
  queued: 'neutral',
  running: 'info',
  partial: 'warning',
  failed: 'warning',
  cancelled: 'neutral',
  no_policy: 'neutral',
  no_run: 'neutral',
};

/**
 * Статус сведения; решения оператора записываются теми же значениями. Отклонённое —
 * нейтрально: красный читался бы как «плохо для компании», а это лишь снятое с карточки
 * сведение (ADR-009).
 */
export const ASSERTION_STATUS_TONE: Record<AssertionStatus, StatusTone> = {
  candidate: 'info',
  text_grounded: 'neutral',
  reviewed_supported: 'success',
  disputed: 'warning',
  rejected: 'neutral',
};

/** Проверено ли сведение, на котором стоит показатель, — те же тоны, что у статуса сведения. */
export const REVIEW_LEVEL_TONE: Record<string, StatusTone> = {
  reviewed: 'success',
  text_grounded: 'neutral',
  legacy_unreviewed: 'neutral',
  disputed: 'warning',
  rejected: 'neutral',
};

/** Неясное упоминание в «Проверке». */
export const AMBIGUITY_STATUS_TONE: Record<AmbiguityStatus, StatusTone> = {
  open: 'warning',
  resolved: 'success',
  dismissed: 'neutral',
};

/** Модель отвечает или нет. Не отвечает — разбор ждёт, собранное цело: предупреждение, а не авария. */
export const modelTone = (ok: boolean): StatusTone => (ok ? 'success' : 'warning');

/** Фоновое задание (сбор, разбор, перенос в карточки) включено или нет. Выключено — решение, не поломка. */
export const switchTone = (on: boolean): StatusTone => (on ? 'success' : 'neutral');

/**
 * Решение оператора по кандидату или совпадению (ДОМ.РФ, сайты компаний): подтверждено — успех, ждёт и отклонено —
 * нейтрально (не поломка), заменено другим — предупреждение. Одно правило для всех очередей решений.
 */
export const DECISION_STATE_TONE: Record<string, StatusTone> = {
  pending: 'neutral',
  confirmed: 'success',
  rejected: 'neutral',
  replaced: 'warning',
};

/** Подсказка модели — не решение и не статус: «скорее он» выделен, остальное спокойно (ДОМ.РФ, пары дублей). */
export const MODEL_HINT_TONE: Record<string, StatusTone> = {
  match: 'info',
  same: 'info',
  no_match: 'neutral',
  different: 'neutral',
  unsure: 'neutral',
};

/** Кто стоит за сведением: проверено оператором — успех, спорно — предупреждение, остальное — нейтрально. */
export const ATTRIBUTION_TONE: Record<string, StatusTone> = {
  analyst_reviewed: 'success',
  analyst_disputed: 'warning',
};

/** Проверка страницы кандидата в сайты: увод на другой хост — предупреждение, остальное — нейтрально. */
export const SITE_CHECK_TONE: Record<string, StatusTone> = {
  redirect_other_host: 'warning',
};
