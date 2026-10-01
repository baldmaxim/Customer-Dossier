// Страницы застройщиков и групп компаний в едином реестре застройщиков наш.дом.рф (этап 20D).
//
// Открываются только страницы, на которые ссылается карточка объекта, подтверждённая оператором:
// обхода каталога нет (этап 20C). Со страницы застройщика берутся реквизиты — из них отдельной
// записью реестра публикуется компания с ИНН и ОГРН — и список его объектов; со страницы группы —
// только список объектов. Объекты из списков становятся кандидатами (domrfCandidates.ts) и сами
// не собираются.

import type { PoolClient } from 'pg';
import { z } from 'zod';

import { query, withTransaction } from '../../db/pool.js';
import { classifyTaxId } from '../../resolve/identifiers.js';
import { payloadHash } from '../../snapshot/canonical.js';
import { toPayload, type IRegistryField, type IRegistryRecord } from './map.js';

export const DOMRF_HOST = 'xn--80az8a.xn--d1aqf.xn--p1ai';

export type DomRfCardKind = 'developer' | 'group';

const PATH_SEGMENT: Record<DomRfCardKind, string> = { developer: 'застройщик', group: 'группа-компаний' };

/** Сколько живёт прочитанная страница: реквизиты не меняются, список объектов растёт медленно. */
export const CARD_TTL_DAYS = 7;

export const domRfCardUrl = (kind: DomRfCardKind, externalRef: string): string =>
  new URL(`/сервисы/единый-реестр-застройщиков/${PATH_SEGMENT[kind]}/${externalRef}`, `https://${DOMRF_HOST}`).toString();

export const domRfObjectUrl = (externalRef: string): string =>
  new URL(`/сервисы/каталог-новостроек/объект/${externalRef}`, `https://${DOMRF_HOST}`).toString();

const ref = z.string().regex(/^[0-9]{1,18}$/);
const optionalText = z.string().trim().max(1000).nullable().optional();

const cardSchema = z
  .object({
    format: z.literal('domrf-card-browser@1'),
    url: z.string().url(),
    kind: z.enum(['developer', 'group']),
    externalRef: ref,
    title: z.string().trim().max(1000),
    documentTitle: optionalText,
    inn: optionalText,
    kpp: optionalText,
    ogrn: optionalText,
    legalAddress: optionalText,
    groupRef: ref.nullable().optional(),
    groupName: optionalText,
    objects: z
      .array(
        z
          .object({ ref, status: optionalText, name: optionalText, place: optionalText })
          .strict(),
      )
      .max(2000),
  })
  .strict();

export type IDomRfCardCapture = z.infer<typeof cardSchema>;

export const isDomRfCardCapture = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && (body as Record<string, unknown>).format === 'domrf-card-browser@1';

/** Снимок страницы реестра: формат, адрес наш.дом.рф и совпадение вида и номера с адресом. */
export const parseDomRfCardCapture = (body: unknown): IDomRfCardCapture => {
  const card = cardSchema.parse(body);
  if (new URL(card.url).hostname !== DOMRF_HOST) throw new Error('адрес не принадлежит наш.дом.рф');
  const path = decodeURIComponent(new URL(card.url).pathname);
  if (!path.endsWith(`/${PATH_SEGMENT[card.kind]}/${card.externalRef}`)) throw new Error('адрес не совпадает со страницей реестра');
  return card;
};

/** Реквизит — только прошедший формат и контрольную сумму: опечатку в канон не пишем. */
const validTaxId = (raw: string | null | undefined, type: 'inn' | 'ogrn'): string | null => {
  const typed = raw ? classifyTaxId(raw) : null;
  return typed && typed.identifierType === type && typed.validationStatus === 'checksum_valid' ? typed.value : null;
};

/** Название с карточки: у застройщика — заголовок страницы, у группы — заголовок вкладки. */
export const cardName = (card: IDomRfCardCapture): string | null =>
  (card.kind === 'developer' ? card.title : card.documentTitle ?? null) || null;

export interface IDomRfDeveloperIdentity {
  externalRef: string;
  name: string;
  inn: string | null;
  ogrn: string | null;
  groupName: string | null;
}

/** Застройщик, пригодный для канона: есть название и хотя бы один верный реквизит. */
export const developerIdentity = (card: IDomRfCardCapture): IDomRfDeveloperIdentity | null => {
  if (card.kind !== 'developer') return null;
  const name = cardName(card);
  const inn = validTaxId(card.inn, 'inn');
  const ogrn = validTaxId(card.ogrn, 'ogrn');
  if (!name || (!inn && !ogrn)) return null;
  return { externalRef: card.externalRef, name, inn, ogrn, groupName: card.groupName ?? null };
};

/**
 * Запись реестра «застройщик» со своей страницы: реквизиты и группа — в тексте снимка, оттуда их
 * публикует общий путь (registry/publish.ts). Список объектов в запись не входит: он меняется, а
 * снимок застройщика должен меняться только вместе с его сведениями.
 */
export const mapDomRfDeveloperCapture = (body: unknown): IRegistryRecord => {
  const card = parseDomRfCardCapture(body);
  const developer = developerIdentity(card);
  if (!developer) throw new Error('на странице застройщика нет названия или верных ИНН и ОГРН');
  const fields: IRegistryField[] = [];
  const add = (label: string, value: string | null | undefined): void => {
    const normalized = value?.replace(/\s+/g, ' ').trim();
    if (normalized) fields.push({ label, value: normalized, raw: normalized });
  };
  add('КПП', card.kpp);
  add('Юридический адрес', card.legalAddress);
  const identity = {
    externalRef: card.externalRef,
    name: developer.name,
    city: null,
    address: card.legalAddress ?? null,
    asOf: null,
    developer: { name: developer.name, legalForm: null, inn: developer.inn, ogrn: developer.ogrn },
    groupName: developer.groupName,
  };
  const payload = toPayload(identity, fields);
  payload.captureMethod = 'browser_page';
  return { type: 'developer', identity, fields, payload, payloadHash: payloadHash(payload) };
};

// ─── Очередь чтения страниц ─────────────────────────────────────────────────────────────────

export interface IDomRfCardRow {
  id: number;
  kind: DomRfCardKind;
  externalRef: string;
  url: string;
  name: string | null;
  inn: string | null;
  ogrn: string | null;
  groupRef: string | null;
  groupName: string | null;
  objectRefs: string[];
  scannedAt: string | null;
  attemptCount: number;
  lastError: string | null;
}

const cardColumns = `id, kind, external_ref AS "externalRef", url, name, inn, ogrn, group_ref AS "groupRef",
  group_name AS "groupName", object_refs AS "objectRefs", scanned_at AS "scannedAt", attempt_count AS "attemptCount", last_error AS "lastError"`;

/** Страница уже известна — не трогаем; новая — в очередь на чтение. */
export const ensureDomRfCard = async (kind: DomRfCardKind, externalRef: string): Promise<void> => {
  await query(
    `INSERT INTO domrf_cards (kind, external_ref, url) VALUES ($1, $2, $3) ON CONFLICT (kind, external_ref) DO NOTHING`,
    [kind, externalRef, domRfCardUrl(kind, externalRef)],
  );
};

export const getDomRfCard = async (kind: DomRfCardKind, externalRef: string): Promise<IDomRfCardRow | null> =>
  (await query<IDomRfCardRow>(`SELECT ${cardColumns} FROM domrf_cards WHERE kind = $1 AND external_ref = $2`, [kind, externalRef]))[0] ?? null;

/** Застройщик из прочитанной страницы — без повторного открытия, если она свежая. */
export const developerFromRow = (row: IDomRfCardRow): IDomRfDeveloperIdentity | null =>
  row.kind === 'developer' && row.name && (row.inn || row.ogrn)
    ? { externalRef: row.externalRef, name: row.name, inn: row.inn, ogrn: row.ogrn, groupName: row.groupName }
    : null;

/** Прочитана и не устарела: повторно страницу открывать незачем. */
export const isFreshCard = (card: IDomRfCardRow | null, now = Date.now()): boolean =>
  card?.scannedAt !== null && card?.scannedAt !== undefined && now - Date.parse(card.scannedAt) < CARD_TTL_DAYS * 86_400_000;

/** Аренда одной страницы к чтению: второй процесс не возьмёт её 10 минут. */
export const claimDueDomRfCard = async (): Promise<IDomRfCardRow | null> =>
  withTransaction(async client => {
    const row = (
      await client.query<IDomRfCardRow>(
        `SELECT ${cardColumns} FROM domrf_cards WHERE next_scan_at <= now()
         ORDER BY next_scan_at, id FOR UPDATE SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!row) return null;
    await client.query(
      `UPDATE domrf_cards SET next_scan_at = now() + interval '10 minutes', attempt_count = attempt_count + 1,
         updated_at = now() WHERE id = $1`,
      [row.id],
    );
    return row;
  });

export const failDomRfCard = async (id: number, error: string, attempts: number): Promise<void> => {
  const delayMinutes = Math.min(24 * 60, 15 * 2 ** Math.min(attempts, 6));
  await query(
    `UPDATE domrf_cards SET last_error = $2, next_scan_at = now() + ($3::int * interval '1 minute'), updated_at = now() WHERE id = $1`,
    [id, error.slice(0, 1000), delayMinutes],
  );
};

/** Прочитанная страница: сведения, список объектов и следующее чтение через CARD_TTL_DAYS. */
export const saveScannedDomRfCard = async (client: PoolClient, card: IDomRfCardCapture): Promise<void> => {
  const developer = developerIdentity(card);
  await client.query(
    `INSERT INTO domrf_cards (kind, external_ref, url, name, inn, ogrn, group_ref, group_name, object_refs, scanned_at, next_scan_at, attempt_count, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now() + ($10::int * interval '1 day'), 0, NULL)
     ON CONFLICT (kind, external_ref) DO UPDATE SET
       url = EXCLUDED.url, name = EXCLUDED.name, inn = EXCLUDED.inn, ogrn = EXCLUDED.ogrn,
       group_ref = EXCLUDED.group_ref, group_name = EXCLUDED.group_name, object_refs = EXCLUDED.object_refs, scanned_at = now(),
       next_scan_at = EXCLUDED.next_scan_at, attempt_count = 0, last_error = NULL, updated_at = now()`,
    [
      card.kind,
      card.externalRef,
      domRfCardUrl(card.kind, card.externalRef),
      cardName(card),
      developer?.inn ?? null,
      developer?.ogrn ?? null,
      card.kind === 'developer' ? card.groupRef ?? null : null,
      card.kind === 'developer' ? card.groupName ?? null : null,
      card.objects.map(o => o.ref),
      CARD_TTL_DAYS,
    ],
  );
};
