// Федресурс (ЕФРСБ) из снимка parser-api.com (этап 24C, bankruptcy-map@2 — 06.10.2026).
//
// Форма сверена с живыми ответами (архив counterparty-risk, 15 списков и 415 сообщений): search_ur → {success,
// total_count, records[{id, inn, ogrn, debtor, category, region, address}]}; найден должник — список его сообщений
// get_org_messages → {total_count, records[{id, date «дд.мм.гггг чч:мм:сс», type, manager_name}]}, новые сверху;
// «Сообщение о судебном акте» — карточкой get_message → {record{act, date_published, case_num, is_actual, …}}.
// Правила:
//  - запись берётся только с тем же ИНН; «записей нет» — сервис ответил, что ЕФРСБ должника не знает на дату
//    проверки. Это не «не проверяли» и не «рисков нет»: намерения кредиторов обратиться в суд публикуются на
//    fedresurs.ru (ЕФРСФДЮЛ), а не в ЕФРСБ, — сервис их не отдаёт, и экран так и пишет;
//  - вид сообщения — по его типу в ЕФРСБ (messageKind), незнакомый тип — «другое», с исходным названием;
//  - аннулированное сообщение («… (аннулировано)» в списке, is_actual = 0 в карточке) считается отдельно и
//    в процедуру не входит;
//  - судебный акт — словами ЕФРСБ (act); actEffect только раскладывает их: введение процедуры, прекращение,
//    завершение, продление и смена управляющего. «Процедура по последнему акту» — самый новый неаннулированный
//    акт, меняющий процедуру; продление и смена управляющего его не подменяют. Незнакомая формулировка —
//    null: показывается как есть и процедурой не считается;
//  - старый снимок (bankruptcy-map@1: карточка get_org без сообщений) — messages: null, «сообщения не запрашивались».
// Оценки нет (ADR-009): «есть в ЕФРСБ» и даже «конкурсное производство» — слова реестра на дату, не вывод портала.

import { asObject } from '../client.js';
import type { IDatasetPayload } from '../datasets.js';

export const BANKRUPTCY_MAP_VERSION = 'bankruptcy-map@2';

export type EfrsbMessageKind =
  | 'court_act'
  | 'intent'
  | 'meeting'
  | 'claims'
  | 'transactions'
  | 'liability'
  | 'sale'
  | 'property'
  | 'annulment'
  | 'other';

/** Что судебный акт делает с процедурой — раскладка слов ЕФРСБ, а не оценка. */
export type EfrsbActEffect =
  | 'observation'
  | 'financial_recovery'
  | 'external_management'
  | 'competition'
  | 'restructuring'
  | 'property_sale'
  | 'settlement'
  | 'terminated'
  | 'completed'
  | 'procedural';

export interface IEfrsbMessage {
  id: string | null;
  /** Дата публикации, YYYY-MM-DD. */
  date: string | null;
  /** Тип словами ЕФРСБ, без пометки «(аннулировано)». */
  type: string;
  kind: EfrsbMessageKind;
  annulled: boolean;
}

export interface IEfrsbCourtAct {
  messageId: string;
  date: string | null;
  /** Судебный акт словами ЕФРСБ: «о введении наблюдения». null — в карточке не указан. */
  act: string | null;
  effect: EfrsbActEffect | null;
  caseNumber: string | null;
  annulled: boolean;
}

export interface IEfrsbMessages {
  /** Сколько сообщений насчитал ЕФРСБ и сколько получено. */
  total: number | null;
  loaded: number;
  complete: boolean;
  first: string | null;
  last: string | null;
  annulled: number;
  /** По видам, без аннулированных, по убыванию. */
  byKind: Array<{ kind: EfrsbMessageKind; count: number }>;
  /** Названия типов вида «другое» — чтобы незнакомое не пряталось. */
  otherTypes: string[];
  /** Последние сообщения, новые сверху. */
  recent: IEfrsbMessage[];
}

export interface IBankruptcyView {
  format: typeof BANKRUPTCY_MAP_VERSION;
  recognized: boolean;
  problems: string[];
  /** Компания есть в ЕФРСБ. */
  found: boolean;
  record: { name: string | null; category: string | null; region: string | null; address: string | null } | null;
  /** Чего в снимке нет и почему (payload.missing): страницы списка, карточки актов, отказ сервиса. */
  missing: string[];
  /** null — снимок без списка сообщений (до bankruptcy-map@2) или список не пришёл. */
  messages: IEfrsbMessages | null;
  /** Судебные акты, чьи карточки получены, новые сверху; null — карточек не запрашивали. */
  courtActs: IEfrsbCourtAct[] | null;
  /** Сколько сообщений о судебном акте в списке и у скольких получена карточка. */
  courtActsCoverage: { listed: number; fetched: number } | null;
  /** Самый новый неаннулированный акт, меняющий процедуру. */
  procedureAct: IEfrsbCourtAct | null;
  /** Самый новый неаннулированный акт любого вида, если он новее procedureAct (продление, смена управляющего). */
  laterAct: IEfrsbCourtAct | null;
  caseNumbers: string[];
}

const RECENT_LIMIT = 10;
const ANNULLED_SUFFIX = /\s*\(аннулировано\)\s*$/i;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.map(asObject).filter((x): x is Record<string, unknown> => x !== null) : [];

const count = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) ? n : null;
};

/** «16.10.2025 14:48:09» или «09.04.2020» → «2025-10-16»; ISO-дата остаётся как есть. */
export const efrsbDate = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) return null;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(raw);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return iso ? iso[1]! : null;
};

/** Тип сообщения ЕФРСБ без пометки об аннулировании и признак аннулирования по списку. */
export const efrsbType = (value: unknown): { type: string; annulled: boolean } => {
  const raw = text(value) ?? 'тип не указан';
  return { type: raw.replace(ANNULLED_SUFFIX, ''), annulled: ANNULLED_SUFFIX.test(raw) };
};

/** Вид сообщения по типу ЕФРСБ. Порядок важен: «судебный акт по … оспаривании сделки» — про сделки, а не процедуру. */
export const messageKind = (type: string): EfrsbMessageKind => {
  const t = type.toLowerCase();
  if (t.startsWith('аннулирование')) return 'annulment';
  if (t.startsWith('сообщение о судебном акте')) return 'court_act';
  if (t.includes('намерени')) return 'intent';
  if (t.includes('сделки должника')) return 'transactions';
  if (t.includes('субсидиарной ответственности') || t.includes('возмещения убытков')) return 'liability';
  if (t.includes('собрани')) return 'meeting';
  if (t.includes('требовани')) return 'claims';
  if (t.includes('торг') || t.includes('купли-продажи')) return 'sale';
  if (t.includes('инвентаризации') || t.includes('оценщика') || t.includes('оценке имущества')) return 'property';
  return 'other';
};

/** Раскладка слов судебного акта. Порядок важен: «о завершении конкурсного производства» — завершение. */
export const actEffect = (act: string | null): EfrsbActEffect | null => {
  if (!act) return null;
  const a = act.toLowerCase();
  if (a.includes('прекращении производства')) return 'terminated';
  if (a.includes('о завершении')) return 'completed';
  if (a.includes('продлении') || a.includes('арбитражного управляющего')) return 'procedural';
  if (a.includes('наблюдения')) return 'observation';
  if (a.includes('финансового оздоровления')) return 'financial_recovery';
  if (a.includes('внешнего управления')) return 'external_management';
  if (a.includes('конкурсного производства')) return 'competition';
  if (a.includes('реструктуризации долгов')) return 'restructuring';
  if (a.includes('реализации имущества')) return 'property_sale';
  if (a.includes('мирового соглашения')) return 'settlement';
  return null;
};

const byDateDesc = <T extends { date: string | null }>(list: T[]): T[] => [...list].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

/** Все сообщения списка снимка без повторов; null — списка в снимке нет (bankruptcy-map@1 или не пришёл). */
export const efrsbMessageList = (payload: IDatasetPayload): IEfrsbMessage[] | null => {
  const pages = payload.responses.filter(r => r.method === 'fedresurs_messages');
  if (pages.length === 0) return null;
  const seen = new Set<string>();
  const messages: IEfrsbMessage[] = [];
  for (const row of pages.flatMap(page => rows(page.body.records))) {
    const id = text(row.id);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const { type, annulled } = efrsbType(row.type);
    messages.push({ id, date: efrsbDate(row.date), type, kind: messageKind(type), annulled });
  }
  return messages;
};

const mapMessages = (payload: IDatasetPayload): IEfrsbMessages | null => {
  const messages = efrsbMessageList(payload);
  if (!messages) return null;
  let total: number | null = null;
  for (const page of payload.responses.filter(r => r.method === 'fedresurs_messages')) total = count(page.body.total_count) ?? total;
  const actual = messages.filter(m => !m.annulled);
  const kinds = new Map<EfrsbMessageKind, number>();
  for (const m of actual) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
  const dates = messages.map(m => m.date).filter((d): d is string => d !== null).sort();
  return {
    total,
    loaded: messages.length,
    complete: total === null || messages.length >= total,
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    annulled: messages.length - actual.length,
    byKind: [...kinds].map(([kind, n]) => ({ kind, count: n })).sort((a, b) => b.count - a.count),
    otherTypes: [...new Set(actual.filter(m => m.kind === 'other').map(m => m.type))],
    recent: byDateDesc(messages).slice(0, RECENT_LIMIT),
  };
};

const mapActs = (payload: IDatasetPayload, annulledInList: ReadonlySet<string>): IEfrsbCourtAct[] => {
  const acts: IEfrsbCourtAct[] = [];
  const seen = new Set<string>();
  for (const r of payload.responses.filter(x => x.method === 'fedresurs_message')) {
    const record = asObject(r.body.record);
    const messageId = text(record?.id) ?? text(r.params.id);
    if (!record || !messageId || seen.has(messageId)) continue;
    seen.add(messageId);
    const act = text(record.act);
    const actual = record.is_actual;
    acts.push({
      messageId,
      date: efrsbDate(record.date_published),
      act,
      effect: actEffect(act),
      caseNumber: text(record.case_num),
      annulled: actual === 0 || actual === '0' || actual === false || annulledInList.has(messageId),
    });
  }
  return byDateDesc(acts);
};

export const mapBankruptcy = (payload: IDatasetPayload): IBankruptcyView => {
  const base: Omit<IBankruptcyView, 'recognized' | 'problems' | 'found' | 'record'> = {
    format: BANKRUPTCY_MAP_VERSION,
    missing: payload.missing,
    messages: null,
    courtActs: null,
    courtActsCoverage: null,
    procedureAct: null,
    laterAct: null,
    caseNumbers: [],
  };
  const search = payload.responses.find(r => r.method === 'fedresurs_ur')?.body;
  if (!search || !Array.isArray(search.records)) {
    return { ...base, recognized: false, problems: ['в снимке нет ответа поиска Федресурса (fedresurs_ur)'], found: false, record: null };
  }
  const match = search.records.map(asObject).find(r => r !== null && text(r.inn) === payload.inn) ?? null;
  if (!match) return { ...base, recognized: true, problems: [], found: false, record: null };
  // Карточка get_org — только в снимках bankruptcy-map@1; в новых имя и адрес — из записи поиска.
  const card = asObject(payload.responses.find(r => r.method === 'fedresurs_org')?.body?.record);
  const record = {
    name: text(card?.full_name) ?? text(card?.name) ?? text(match.debtor),
    category: text(match.category),
    region: text(match.region),
    address: text(card?.address) ?? text(match.address),
  };

  const messages = mapMessages(payload);
  if (!messages) return { ...base, recognized: true, problems: [], found: true, record };

  const listed = payload.responses
    .filter(r => r.method === 'fedresurs_messages')
    .flatMap(r => rows(r.body.records))
    .map(row => ({ id: text(row.id), ...efrsbType(row.type) }));
  const annulledInList = new Set(listed.filter(m => m.annulled && m.id).map(m => m.id!));
  const listedActs = new Set(listed.filter(m => m.id && !m.annulled && messageKind(m.type) === 'court_act').map(m => m.id!));
  const courtActs = mapActs(payload, annulledInList);
  const actual = courtActs.filter(a => !a.annulled);
  const procedureAct = actual.find(a => a.effect !== null && a.effect !== 'procedural') ?? null;
  const newest = actual[0] ?? null;
  return {
    ...base,
    recognized: true,
    problems: [],
    found: true,
    record,
    messages,
    courtActs,
    courtActsCoverage: { listed: listedActs.size, fetched: courtActs.filter(a => listedActs.has(a.messageId)).length },
    procedureAct,
    laterAct: newest && newest !== procedureAct && (procedureAct === null || (newest.date ?? '') > (procedureAct.date ?? '')) ? newest : null,
    caseNumbers: [...new Set(courtActs.map(a => a.caseNumber).filter((n): n is string => n !== null))],
  };
};
