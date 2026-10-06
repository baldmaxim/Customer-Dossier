// Строка «Генподрядчики» карточки объекта ДОМ.РФ → список «название + ИНН» (этап 24D).
//
// Сайт пишет генподрядчиков одной строкой: «ООО СУ-10 (ИНН: 7736255508)», несколько — через запятую или
// точку с запятой. Реквизит берётся только с верной контрольной суммой: по нему генподрядчик находится среди
// юрлиц портала без сравнения названий. Строку без ИНН делим только по разделителю перед формой
// («…, АО …»): запятая внутри названия не должна разрезать одну компанию на две. Это сведения сайта на дату
// снимка, а не утверждение канона — в assertions ничего не пишется (registry/publish.ts пишет только застройщика).

import { isValidInn } from '../resolve/normalize.js';

export interface IRegistryContractor {
  name: string;
  /** ИНН с верной контрольной суммой; иначе null (неверный реквизит не используется для поиска). */
  inn: string | null;
}

const INN_MARK = /\(\s*ИНН\s*:?\s*(\d{10}|\d{12})\s*\)/giu;
const SEPARATORS = /^[\s,;]+|[\s,;]+$/gu;
const FORM_SPLIT = /\s*;\s*|,\s+(?=(?:ООО|АО|ПАО|ЗАО|ОАО|НАО|ИП|ГУП|ФГУП|МУП|ГБУ|ГКУ)\s)/u;

const cleanName = (value: string): string => value.replace(SEPARATORS, '').replace(/\s+/gu, ' ').trim();

const splitWithoutInn = (value: string): IRegistryContractor[] =>
  value
    .split(FORM_SPLIT)
    .map(cleanName)
    .filter(name => name !== '')
    .map(name => ({ name, inn: null }));

export const parseRegistryContractors = (text: string | null | undefined): IRegistryContractor[] => {
  if (!text || text.trim() === '') return [];
  const out: IRegistryContractor[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INN_MARK)) {
    const start = match.index ?? 0;
    const name = cleanName(text.slice(cursor, start));
    const inn = match[1]!;
    if (name !== '') out.push({ name, inn: isValidInn(inn) ? inn : null });
    cursor = start + match[0].length;
  }
  out.push(...splitWithoutInn(text.slice(cursor)));
  // Один генподрядчик дважды в строке — одна запись.
  const seen = new Set<string>();
  return out.filter(c => {
    const key = c.inn ?? `name:${c.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
