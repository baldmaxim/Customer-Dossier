// Федресурс (ЕФРСБ) из снимка parser-api.com (этап 24C, bankruptcy-map@1).
//
// Форма сверена с живым ответом (06.10.2026): search_ur → {success, total_count, records[{id, inn, ogrn, debtor,
// category, region, address}]}; найдено — карточка get_org → {record{name, full_name, inn, ogrn, address, form}}.
// Запись берётся только с тем же ИНН. «Записей нет» — сервис ответил, что ЕФРСБ компанию не знает на дату проверки;
// это не «не проверяли». Есть запись — это не вывод о банкротстве: в ЕФРСБ бывают и сообщения о намерении кредитора,
// и о сделках; сами сообщения — на bankrot.fedresurs.ru. Оценки нет (ADR-009).

import { asObject } from '../client.js';
import type { IDatasetPayload } from '../datasets.js';

export const BANKRUPTCY_MAP_VERSION = 'bankruptcy-map@1';

export interface IBankruptcyView {
  format: typeof BANKRUPTCY_MAP_VERSION;
  recognized: boolean;
  problems: string[];
  /** Компания есть в ЕФРСБ. */
  found: boolean;
  record: { name: string | null; category: string | null; region: string | null; address: string | null } | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

export const mapBankruptcy = (payload: IDatasetPayload): IBankruptcyView => {
  const search = payload.responses.find(r => r.method === 'fedresurs_ur')?.body;
  if (!search || !Array.isArray(search.records)) {
    return { format: BANKRUPTCY_MAP_VERSION, recognized: false, problems: ['в снимке нет ответа поиска Федресурса (fedresurs_ur)'], found: false, record: null };
  }
  const match = search.records.map(asObject).find(r => r !== null && text(r.inn) === payload.inn) ?? null;
  if (!match) return { format: BANKRUPTCY_MAP_VERSION, recognized: true, problems: [], found: false, record: null };
  const card = asObject(payload.responses.find(r => r.method === 'fedresurs_org')?.body?.record);
  return {
    format: BANKRUPTCY_MAP_VERSION,
    recognized: true,
    problems: [],
    found: true,
    record: {
      name: text(card?.full_name) ?? text(card?.name) ?? text(match.debtor),
      category: text(match.category),
      region: text(match.region),
      address: text(card?.address) ?? text(match.address),
    },
  };
};
