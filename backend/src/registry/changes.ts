// Разница двух снимков реестра (этап 20B). Чистая функция, проверяется без базы.
//
// Отдельной таблицы «изменений» нет: снимки неизменяемы и лежат по редакциям,
// разница считается на чтении. Второй источник правды об одном и том же
// расходится с первым при первой же правке кода.
//
// Что сравнивается: поля снимка по подписи и географические/идентификационные
// значения. Появление и исчезновение поля — тоже изменение: реестр перестал
// сообщать срок сдачи — это новость, а не отсутствие новости. Срок сдачи того же
// квартала другим форматом («31.03.2028» → «I кв. 2028») — не изменение: одно правило
// с «Сроками и продажами» и «Новым» (values.ts::completionChange). Сравниваются снимки
// одного дома (registry/read.ts): разница соседних домов ЖК изменением не является.

import { HOUSE_LABELS } from './houses.js';
import { completionChange } from './values.js';

export interface IRegistryPayloadField {
  label: string;
  value: string;
  raw?: string | number | boolean | null;
}

export interface IRegistryPayload {
  captureMethod?: 'browser_page';
  identity: {
    externalRef: string;
    name: string;
    city: string | null;
    address: string | null;
    asOf: string | null;
    developer: { name: string; legalForm: string | null; inn: string | null; ogrn: string | null } | null;
    groupName: string | null;
  };
  fields: IRegistryPayloadField[];
}

export interface IRegistryFieldChange {
  label: string;
  /** null — поля не было в прошлом снимке. */
  from: string | null;
  /** null — реестр перестал сообщать это поле. */
  to: string | null;
}

const identityPairs = (payload: IRegistryPayload): Array<[string, string | null]> => [
  ['Название', payload.identity.name],
  ['Город', payload.identity.city],
  ['Адрес', payload.identity.address],
  ['Застройщик', payload.identity.developer?.name ?? null],
  ['ИНН застройщика', payload.identity.developer?.inn ?? null],
  ['Группа компаний', payload.identity.groupName],
];

const fieldMap = (payload: IRegistryPayload): Map<string, string> => {
  const map = new Map<string, string>();
  for (const [label, value] of identityPairs(payload)) {
    if (value !== null && value !== '') map.set(label, value);
  }
  for (const field of payload.fields) map.set(field.label, field.value);
  return map;
};

const COMPLETION_LABELS: ReadonlySet<string> = new Set(HOUSE_LABELS.completion);

/** Изменения от предыдущего снимка к текущему, в порядке появления полей в текущем. */
export const diffPayloads = (previous: IRegistryPayload, current: IRegistryPayload): IRegistryFieldChange[] => {
  const before = fieldMap(previous);
  const after = fieldMap(current);
  const changes: IRegistryFieldChange[] = [];
  for (const [label, value] of after) {
    const old = before.get(label);
    if (old === undefined) changes.push({ label, from: null, to: value });
    else if (old !== value && !(COMPLETION_LABELS.has(label) && completionChange(old, value) === null)) changes.push({ label, from: old, to: value });
  }
  for (const [label, value] of before) {
    if (!after.has(label)) changes.push({ label, from: value, to: null });
  }
  return changes;
};
