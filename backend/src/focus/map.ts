// Ответ Контур.Фокуса → строки карточки (focus-map@1). Чистые функции, проверяются без сети и базы.
//
// Ответ хранится целиком (focus_records.payload), карта применяется на чтении: правка карты не требует
// повторного платного запроса. Неизвестное поле пропускается, а не превращается в «нет данных»: Фокус
// присылает только то, что есть в ЕГРЮЛ. Значения — строками для экрана, даты — ДД.ММ.ГГГГ.
//
// Сводных оценок Фокуса (экспресс-отчёт с «зелёными/красными» фактами, скоринг) карта не читает:
// итоговой оценки надёжности в портале нет (ADR-009).

import type { FocusMethod } from './client.js';

export const FOCUS_MAP_VERSION = 'focus-map@1';

export interface IFocusField {
  key: string;
  label: string;
  value: string;
}

export interface IFocusSummary {
  /** Статус словами из ЕГРЮЛ: «Действующее», «В стадии ликвидации»… */
  status: string | null;
  head: string | null;
  address: string | null;
}

export interface IFocusFieldChange {
  label: string;
  /** null — поля не было в прошлом ответе. */
  from: string | null;
  /** null — Фокус перестал сообщать это поле. */
  to: string | null;
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
};

/** '2020-01-31' → '31.01.2020'; иное — как есть. */
export const ruDate = (value: unknown): string | null => {
  const s = str(value);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
};

const rubles = (value: unknown): string | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  if (!Number.isFinite(n)) return null;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n).replace(/ /g, ' ')} ₽`;
};

// --- Адрес -------------------------------------------------------------------------------------------

/** Элемент разобранного адреса: { topoShortName: 'ул', topoValue: 'Ленина' } → «ул Ленина». */
const topo = (value: unknown, valueFirst: boolean): string | null => {
  const o = obj(value);
  const v = str(o?.topoValue);
  if (!o || !v) return null;
  const short = str(o.topoShortName);
  if (!short) return v;
  return valueFirst ? `${v} ${short}` : `${short} ${v}`;
};

/** Регион пишется «Свердловская обл», но «г Москва» и «Респ Татарстан». */
const regionText = (value: unknown): string | null => {
  const short = str(obj(value)?.topoShortName);
  return topo(value, short !== null && short !== 'г' && short !== 'Респ');
};

export const formatAddress = (value: unknown): string | null => {
  const address = obj(value);
  if (!address) return null;
  const parsed = obj(address.parsedAddressRF);
  if (parsed) {
    const parts = [
      str(parsed.zipCode),
      regionText(parsed.regionName),
      topo(parsed.district, false),
      topo(parsed.city, false),
      topo(parsed.settlement, false),
      topo(parsed.street, false),
      topo(parsed.house, false) ?? str(parsed.houseRaw),
      topo(parsed.bulk, false) ?? str(parsed.bulkRaw),
      topo(parsed.flat, false) ?? str(parsed.flatRaw),
    ].filter((p): p is string => p !== null);
    if (parts.length > 0) return parts.join(', ');
  }
  const foreign = obj(address.foreignAddress);
  if (foreign) {
    const parts = [str(foreign.countryName), str(foreign.addressString)].filter((p): p is string => p !== null);
    if (parts.length > 0) return parts.join(', ');
  }
  return str(address.addressString);
};

// --- Метод req ---------------------------------------------------------------------------------------

export const statusText = (value: unknown): string | null => {
  const status = obj(value);
  if (!status) return null;
  const text = str(status.statusString) ?? (status.dissolved === true ? 'Прекратило деятельность' : status.dissolving === true ? 'В стадии ликвидации' : null);
  if (!text) return null;
  const since = ruDate(status.date);
  return since ? `${text} (с ${since})` : text;
};

const sinceText = (item: Json): string => {
  const since = ruDate(item.firstDate) ?? ruDate(item.date);
  return since ? `, с ${since}` : '';
};

const headsText = (value: unknown): string | null => {
  const heads = arr(value)
    .map(obj)
    .filter((h): h is Json => h !== null && str(h.fio) !== null)
    .map(h => `${str(h.fio)}${str(h.position) ? ` — ${str(h.position)}` : ''}${sinceText(h)}`);
  return heads.length > 0 ? heads.join('; ') : null;
};

const companiesText = (value: unknown, nameKeys: readonly string[]): string | null => {
  const items = arr(value)
    .map(obj)
    .filter((c): c is Json => c !== null)
    .map(c => {
      const name = nameKeys.map(k => str(c[k])).find(n => n !== null) ?? null;
      const inn = str(c.inn);
      if (!name && !inn) return null;
      return [name, inn ? `ИНН ${inn}` : null].filter(Boolean).join(', ');
    })
    .filter((t): t is string => t !== null);
  return items.length > 0 ? items.join('; ') : null;
};

const push = (fields: IFocusField[], key: string, label: string, value: string | null): void => {
  if (value !== null) fields.push({ key, label, value });
};

export const mapReq = (payload: Json): IFocusField[] => {
  const fields: IFocusField[] = [];
  const ul = obj(payload.UL);
  const ip = obj(payload.IP);
  if (ul) {
    const name = obj(ul.legalName);
    push(fields, 'name', 'Краткое наименование', str(name?.short) ?? str(name?.readable));
    push(fields, 'fullName', 'Полное наименование', str(name?.full));
    push(fields, 'status', 'Статус', statusText(ul.status));
    push(fields, 'registrationDate', 'Дата регистрации', ruDate(ul.registrationDate));
    push(fields, 'dissolutionDate', 'Дата прекращения', ruDate(ul.dissolutionDate));
    push(fields, 'address', 'Юридический адрес', formatAddress(ul.legalAddress));
    push(fields, 'heads', 'Руководитель', headsText(ul.heads));
    push(fields, 'managementCompanies', 'Управляющая организация', companiesText(ul.managementCompanies, ['name']));
    push(fields, 'opf', 'Организационно-правовая форма', str(ul.opf));
    push(fields, 'kpp', 'КПП', str(ul.kpp));
    push(fields, 'okpo', 'ОКПО', str(ul.okpo));
  } else if (ip) {
    push(fields, 'fio', 'ФИО предпринимателя', str(ip.fio));
    push(fields, 'status', 'Статус', statusText(ip.status));
    push(fields, 'registrationDate', 'Дата регистрации', ruDate(ip.registrationDate));
    push(fields, 'dissolutionDate', 'Дата прекращения', ruDate(ip.dissolutionDate));
    push(fields, 'okpo', 'ОКПО', str(ip.okpo));
  }
  return fields;
};

// --- Метод egrDetails --------------------------------------------------------------------------------

/** Сколько учредителей перечислять: у акционерных обществ их бывают сотни. */
export const FOUNDERS_SHOWN = 10;

const shareText = (value: unknown): string | null => {
  const share = obj(value);
  if (!share) return null;
  const percent = typeof share.percentagePlain === 'number' ? share.percentagePlain : null;
  if (percent !== null) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(percent)}%`;
  return rubles(share.sumInRubles);
};

const foundersText = (ul: Json): string | null => {
  const people = arr(ul.foundersFL)
    .map(obj)
    .filter((f): f is Json => f !== null && str(f.fio) !== null)
    .map(f => ({ name: str(f.fio)!, share: shareText(f.share) }));
  const companies = arr(ul.foundersUL)
    .map(obj)
    .filter((f): f is Json => f !== null && (str(f.fullName) ?? str(f.name)) !== null)
    .map(f => ({ name: `${str(f.fullName) ?? str(f.name)}${str(f.inn) ? `, ИНН ${str(f.inn)}` : ''}`, share: shareText(f.share) }));
  const foreign = arr(ul.foundersForeign)
    .map(obj)
    .filter((f): f is Json => f !== null && (str(f.fullName) ?? str(f.name)) !== null)
    .map(f => ({ name: `${str(f.fullName) ?? str(f.name)}${str(f.country) ? ` (${str(f.country)})` : ''}`, share: shareText(f.share) }));
  const all = [...people, ...companies, ...foreign];
  if (all.length === 0) return null;
  const shown = all.slice(0, FOUNDERS_SHOWN).map(f => (f.share ? `${f.name} — ${f.share}` : f.name));
  const rest = all.length - shown.length;
  return rest > 0 ? `${shown.join('; ')}; и ещё ${rest}` : shown.join('; ');
};

const activityText = (activities: unknown): string | null => {
  const principal = obj(obj(activities)?.principalActivity);
  if (!principal) return null;
  const parts = [str(principal.code), str(principal.text)].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' ') : null;
};

export const mapEgrDetails = (payload: Json): IFocusField[] => {
  const fields: IFocusField[] = [];
  const ul = obj(payload.UL);
  const ip = obj(payload.IP);
  const body = ul ?? ip;
  if (!body) return fields;
  push(fields, 'activity', 'Основной вид деятельности', activityText(body.activities));
  if (ul) {
    const capital = obj(ul.statedCapital);
    push(fields, 'capital', 'Уставный капитал', rubles(capital?.sum));
    push(fields, 'founders', 'Учредители', foundersText(ul));
    push(fields, 'predecessors', 'Правопредшественник', companiesText(ul.predecessors, ['name', 'fullName']));
    push(fields, 'successors', 'Правопреемник', companiesText(ul.successors, ['name', 'fullName']));
  }
  return fields;
};

export const mapMethod = (method: FocusMethod, payload: Json): IFocusField[] =>
  method === 'req' ? mapReq(payload) : mapEgrDetails(payload);

// --- Карточка, ссылка, разница -----------------------------------------------------------------------

/** Порядок строк карточки: опознание и статус, руководитель и адрес, деятельность и владельцы, коды. */
const FIELD_ORDER = [
  'name',
  'fio',
  'fullName',
  'status',
  'heads',
  'managementCompanies',
  'address',
  'activity',
  'registrationDate',
  'dissolutionDate',
  'capital',
  'founders',
  'predecessors',
  'successors',
  'opf',
  'kpp',
  'okpo',
];

export const orderFields = (fields: readonly IFocusField[]): IFocusField[] => {
  const rank = (f: IFocusField): number => {
    const i = FIELD_ORDER.indexOf(f.key);
    return i === -1 ? FIELD_ORDER.length : i;
  };
  return [...fields].sort((a, b) => rank(a) - rank(b));
};

export const summaryOf = (fields: readonly IFocusField[]): IFocusSummary => {
  const value = (key: string): string | null => fields.find(f => f.key === key)?.value ?? null;
  return { status: value('status'), head: value('heads'), address: value('address') };
};

/** Ссылка на карточку компании в самом Фокусе — только на его домен. */
export const focusHrefOf = (payload: Json): string | null => {
  const href = str(payload.focusHref);
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && url.hostname === 'focus.kontur.ru' ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Изменения от прошлого ответа к текущему, в порядке строк текущего; исчезнувшие — в конце. */
export const diffFields = (previous: readonly IFocusField[], current: readonly IFocusField[]): IFocusFieldChange[] => {
  const before = new Map(previous.map(f => [f.label, f.value]));
  const after = new Map(current.map(f => [f.label, f.value]));
  const changes: IFocusFieldChange[] = [];
  for (const [label, value] of after) {
    const old = before.get(label);
    if (old === undefined) changes.push({ label, from: null, to: value });
    else if (old !== value) changes.push({ label, from: old, to: value });
  }
  for (const [label, value] of before) {
    if (!after.has(label)) changes.push({ label, from: value, to: null });
  }
  return changes;
};

/** Имена ключей ответа без значений — для пробы: увидеть, совпадает ли карта с живым ответом. */
export const availablePaths = (value: unknown, prefix = '', out: Set<string> = new Set()): string[] => {
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 3)) availablePaths(item, `${prefix}[]`, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Json)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      out.add(path);
      availablePaths(child, path, out);
    }
  }
  return [...out].sort();
};
