// Подписи свода ДОМ.РФ по домам объекта (ICompanyObjectRegistry, backend registry/houses.ts) — одни на карточке объекта
// во вкладке «Объекты» и в паспорте объекта. Числа считает сервер; здесь только слова: срок — диапазоном, разный статус
// домов — «сдано N из M», цена — диапазоном (среднего нет: средняя цена разных домов ничего не значит).
//
// Статус объекта — одно правило (07.10.2026): сведения ДОМ.РФ, а без них — состояние по событиям публикаций.

import type { ICompanyObject, ICompanyObjectRegistry } from '../api/types';
import { formatCount, formatCountWord } from './format';
import { CONTEXT_STATE_LABELS, formatMoney, formatPercent } from './labels';

const OF_HOUSES = ['дома', 'домов', 'домов'] as const;

/** «IV кв. 2026» или «IV кв. 2026 – II кв. 2028». */
export const completionText = (summary: Pick<ICompanyObjectRegistry, 'completion'>): string | null => {
  const c = summary.completion;
  if (!c) return null;
  return c.from === c.to ? c.from : `${c.from} – ${c.to}`;
};

/** Статус словами сайта, общий у всех домов; разный — «сдано 1 из 3 домов». */
export const registryStatusText = (summary: Pick<ICompanyObjectRegistry, 'status' | 'houses' | 'delivered'>): string | null => {
  if (summary.status) return summary.status;
  if (summary.houses > 1) return `сдано ${formatCount(summary.delivered)} из ${formatCountWord(summary.houses, OF_HOUSES)}`;
  return null;
};

/** «933 тыс. ₽» или «210 тыс. ₽ – 1,1 млн ₽». */
export const priceRangeText = (range: ICompanyObjectRegistry['pricePerSqm']): string | null => {
  if (!range) return null;
  return range.min === range.max ? formatMoney(range.min) : `${formatMoney(range.min)} – ${formatMoney(range.max)}`;
};

export interface IRegistryFact {
  label: string;
  value: string;
}

/** Главные числа свода по порядку важности — только сообщённые сайтом. */
export const registryFacts = (summary: ICompanyObjectRegistry): IRegistryFact[] =>
  [
    { label: 'Квартир', value: summary.apartments !== null ? formatCount(summary.apartments) : null },
    { label: 'Цена м²', value: priceRangeText(summary.pricePerSqm) },
    { label: 'Продано', value: summary.soldShare !== null ? formatPercent(summary.soldShare) : null },
    { label: 'Класс', value: summary.propertyClass },
    { label: 'Этажей', value: summary.floors },
  ].filter((f): f is IRegistryFact => f.value !== null);

/** С заглавной, как статус на сайте ДОМ.РФ: «Строится» рядом со «строится» читалось как два разных. */
const capitalized = (text: string): string => text.charAt(0).toLocaleUpperCase('ru') + text.slice(1);

/** Статус объекта: сведения ДОМ.РФ, без них — состояние по событиям публикаций. */
export const objectStatusText = (o: Pick<ICompanyObject, 'registry' | 'state'>): string | null => {
  if (o.registry) return registryStatusText(o.registry);
  const label = o.state ? CONTEXT_STATE_LABELS[o.state.state] : undefined;
  return label ? capitalized(label) : null;
};
