// Русские подписи для машинных значений + форматирование.
// Одно место: иначе «general_contractor» превращается в «генподрядчик» на одном
// экране и в «Генеральный подрядчик» на другом.

import type { Role, Sentiment } from '../api/types';

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

/** Суммы в тенге бывают в миллиардах — полное число нечитаемо. */
export const formatMoney = (amount: number): string => {
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(1)} млрд ₸`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(1)} млн ₸`;
  return `${amount.toLocaleString('ru-RU')} ₸`;
};

export const formatPercent = (share: number | null): string =>
  share === null ? '—' : `${Math.round(share * 100)} %`;
