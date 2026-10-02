// Объекты, найденные на страницах застройщика и группы (этап 20D), — кандидаты, а не сбор.
//
// Портал предлагает, оператор решает: «подтвердить» ставит ссылку в обычную очередь сбора
// (domrfTargets.ts), «отклонить» убирает кандидата из списка, «заменить» ставит вместо найденной
// карточки ту, что указал оператор. Отклонённый кандидат при следующем чтении страницы не возвращается.
//
// Решение владельца 02.10.2026 (ADR-012 п. 32): «Это он» по компании — согласие собирать объекты её
// страницы. Кандидаты со страницы, которую оператор подтвердил как страницу компании портала,
// подтверждаются сами (autoConfirmLinkedDomRfCandidates); вручную решаются только найденные на
// страницах без такого решения. Отклонить отдельный объект оператор может по-прежнему.

import type { PoolClient } from 'pg';

import { query, withTransaction } from '../../db/pool.js';
import { domRfObjectUrl, type DomRfCardKind, type IDomRfCardCapture } from './domrfCards.js';
import { DomRfTargetError, parseDomRfObjectUrl, registerDomRfTarget } from './domrfTargets.js';

export type DomRfCandidateState = 'pending' | 'confirmed' | 'rejected' | 'replaced';

export interface IDomRfCandidate {
  id: number;
  externalRef: string;
  url: string;
  label: string | null;
  details: string | null;
  foundViaKind: DomRfCardKind;
  foundViaRef: string;
  state: DomRfCandidateState;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  replacementRef: string | null;
  firstSeenAt: string;
}

/** Страница, на которой нашлись кандидаты, и заказчик портала с тем же ИНН, если он есть. */
export interface IDomRfCandidateSource {
  kind: DomRfCardKind;
  externalRef: string;
  url: string;
  name: string | null;
  inn: string | null;
  scannedAt: string | null;
  companyId: number | null;
  companyName: string | null;
  pending: number;
}

/**
 * Кандидаты со страницы: объекты, которых нет в сборе. Уже известный кандидат обновляет только
 * подпись и время — решение оператора не перезаписывается.
 */
export const upsertDomRfCandidates = async (client: PoolClient, card: IDomRfCardCapture): Promise<number> => {
  if (card.objects.length === 0) return 0;
  const refs = card.objects.map(o => o.ref);
  const labels = card.objects.map(o => o.name ?? null);
  const details = card.objects.map(o => [o.status, o.place].filter(Boolean).join(' · ') || null);
  const urls = card.objects.map(o => domRfObjectUrl(o.ref));
  const result = await client.query<{ inserted: boolean }>(
    `INSERT INTO domrf_candidates (external_ref, url, label, details, found_via_kind, found_via_ref)
     SELECT o.ref, o.url, o.label, o.details, $5, $6
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS o(ref, label, details, url)
     WHERE NOT EXISTS (SELECT 1 FROM domrf_targets t WHERE t.external_ref = o.ref)
     ON CONFLICT (external_ref) DO UPDATE SET
       label = coalesce(EXCLUDED.label, domrf_candidates.label),
       details = coalesce(EXCLUDED.details, domrf_candidates.details),
       last_seen_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [refs, labels, details, urls, card.kind, card.externalRef],
  );
  return result.rows.filter(r => r.inserted).length;
};

const candidateColumns = `c.id, c.external_ref AS "externalRef", c.url, c.label, c.details,
  c.found_via_kind AS "foundViaKind", c.found_via_ref AS "foundViaRef", c.state,
  c.decided_by AS "decidedBy", c.decided_at AS "decidedAt", c.decision_note AS "decisionNote",
  c.replacement_ref AS "replacementRef", c.first_seen_at AS "firstSeenAt"`;

export const listDomRfCandidates = async (
  state: 'pending' | 'decided',
): Promise<{ items: IDomRfCandidate[]; sources: IDomRfCandidateSource[] }> => {
  const items = await query<IDomRfCandidate>(
    `SELECT ${candidateColumns} FROM domrf_candidates c
     WHERE ${state === 'pending' ? "c.state = 'pending'" : "c.state <> 'pending'"}
     ORDER BY c.found_via_kind, c.found_via_ref, c.label NULLS LAST, c.external_ref::bigint
     LIMIT 1000`,
  );
  // Заказчик — по ИНН или ОГРН со страницы застройщика среди действующих реквизитов портала.
  const sources = await query<IDomRfCandidateSource>(
    `SELECT d.kind, d.external_ref AS "externalRef", d.url, d.name, d.inn, d.scanned_at AS "scannedAt",
            co.id AS "companyId", co.name AS "companyName",
            (SELECT count(*)::int FROM domrf_candidates c
              WHERE c.found_via_kind = d.kind AND c.found_via_ref = d.external_ref AND c.state = 'pending') AS pending
     FROM domrf_cards d
     LEFT JOIN LATERAL (
       SELECT c.id, c.name FROM companies c
       WHERE c.merged_into_id IS NULL AND c.id IN (
         SELECT ei.company_id FROM entity_identifiers ei
         WHERE ei.status = 'active'
           AND ((ei.identifier_type = 'inn' AND ei.value = d.inn) OR (ei.identifier_type = 'ogrn' AND ei.value = d.ogrn))
         UNION
         -- Совместимая проекция реквизита (companies.tax_id), как в резолвере.
         SELECT c2.id FROM companies c2 WHERE c2.tax_id IS NOT NULL AND c2.tax_id IN (d.inn, d.ogrn)
         UNION
         -- Страницу подтвердил оператор как страницу этого заказчика (шаг 2, у группы ИНН нет).
         SELECT l.company_id FROM domrf_company_links l
         WHERE l.kind = d.kind AND l.external_ref = d.external_ref AND l.state = 'confirmed'
       )
       ORDER BY c.id LIMIT 1
     ) co ON true
     ORDER BY d.kind, d.name NULLS LAST, d.external_ref`,
  );
  return { items, sources };
};

export class DomRfCandidateError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'already_decided' | 'invalid',
  ) {
    super(message);
    this.name = 'DomRfCandidateError';
  }
}

/** Кандидат под блокировкой; подтверждённый и заменённый уже стоят в сборе — решение не меняется. */
const lockCandidate = async (client: PoolClient, id: number): Promise<{ url: string; external_ref: string; state: DomRfCandidateState }> => {
  const row = (
    await client.query<{ url: string; external_ref: string; state: DomRfCandidateState }>(
      'SELECT url, external_ref, state FROM domrf_candidates WHERE id = $1 FOR UPDATE',
      [id],
    )
  ).rows[0];
  if (!row) throw new DomRfCandidateError(`Кандидат №${id} не найден`, 'not_found');
  if (row.state === 'confirmed' || row.state === 'replaced') {
    throw new DomRfCandidateError('Решение уже принято: карточка стоит в сборе — уберите её в списке «Карточки ДОМ.РФ»', 'already_decided');
  }
  return row;
};

const decide = async (
  client: PoolClient,
  id: number,
  state: Exclude<DomRfCandidateState, 'pending'>,
  actor: string,
  extra: { note?: string | null; replacementRef?: string | null } = {},
): Promise<void> => {
  await client.query(
    `UPDATE domrf_candidates SET state = $2, decided_by = $3, decided_at = now(), decision_note = $4, replacement_ref = $5 WHERE id = $1`,
    [id, state, actor, extra.note ?? null, extra.replacementRef ?? null],
  );
};

/** «Подтвердить»: найденная карточка — в обычную очередь сбора, при желании сразу к объекту портала. */
export const confirmDomRfCandidate = async (id: number, actor: string, projectId: number | null = null): Promise<void> => {
  const candidate = await withTransaction(client => lockCandidate(client, id));
  await registerDomRfTarget({ url: candidate.url, projectId });
  await withTransaction(async client => {
    await lockCandidate(client, id);
    await decide(client, id, 'confirmed', actor);
  });
};

/** «Отклонить»: не тот объект. Остаётся в истории и при следующем чтении страницы не возвращается. */
export const rejectDomRfCandidate = async (id: number, actor: string, note: string | null = null): Promise<void> => {
  await withTransaction(async client => {
    await lockCandidate(client, id);
    await decide(client, id, 'rejected', actor, { note: note?.trim().slice(0, 500) || null });
  });
};

/** «Заменить»: вместо найденной карточки в сбор встаёт правильная, указанная оператором. */
export const replaceDomRfCandidate = async (
  id: number,
  actor: string,
  url: string,
  projectId: number | null = null,
): Promise<void> => {
  const parsed = parseDomRfObjectUrl(url);
  const candidate = await withTransaction(client => lockCandidate(client, id));
  if (parsed.externalRef === candidate.external_ref) {
    throw new DomRfCandidateError('Это та же карточка — нажмите «Подтвердить»', 'invalid');
  }
  await registerDomRfTarget({ url: parsed.url, projectId });
  await withTransaction(async client => {
    await lockCandidate(client, id);
    await decide(client, id, 'replaced', actor, { replacementRef: parsed.externalRef });
  });
};

/** Кто подтвердил кандидата сам: в списке решений видно, что это правило, а не оператор. */
export const AUTO_CONFIRM_ACTOR = 'auto';
export const AUTO_CONFIRM_NOTE = 'страница компании подтверждена оператором — её объекты собираются';
/** Кандидатов за один шаг: тысячи с больших групп разойдутся за несколько минут короткими транзакциями. */
const AUTO_CONFIRM_BATCH = 500;

/**
 * Кандидаты со страниц, которые оператор подтвердил как страницы компаний портала («Это он»), — в сбор
 * без отдельного решения. Страница, снятая с чтения, не в счёт; отклонённые и решённые не трогаются.
 * Ссылка в очередь и решение по кандидату — одной транзакцией. Возвращает, сколько подтверждено.
 */
export const autoConfirmLinkedDomRfCandidates = async (limit = AUTO_CONFIRM_BATCH): Promise<number> =>
  withTransaction(async client => {
    const picked = (
      await client.query<{ id: number; external_ref: string; url: string }>(
        `SELECT c.id, c.external_ref, c.url
         FROM domrf_candidates c
         JOIN domrf_cards d ON d.kind = c.found_via_kind AND d.external_ref = c.found_via_ref AND d.withdrawn_at IS NULL
         WHERE c.state = 'pending'
           AND EXISTS (
             SELECT 1 FROM domrf_company_links l
             WHERE l.kind = c.found_via_kind AND l.external_ref = c.found_via_ref AND l.state = 'confirmed')
         ORDER BY c.id
         LIMIT $1
         FOR UPDATE OF c SKIP LOCKED`,
        [limit],
      )
    ).rows;
    if (picked.length === 0) return 0;
    await client.query(
      `INSERT INTO domrf_targets (external_ref, url)
       SELECT ref, url FROM unnest($1::text[], $2::text[]) AS o(ref, url)
       ON CONFLICT (external_ref) DO NOTHING`,
      [picked.map(p => p.external_ref), picked.map(p => p.url)],
    );
    await client.query(
      `UPDATE domrf_candidates SET state = 'confirmed', decided_by = $2, decided_at = now(), decision_note = $3
       WHERE id = ANY($1::bigint[])`,
      [picked.map(p => p.id), AUTO_CONFIRM_ACTOR, AUTO_CONFIRM_NOTE],
    );
    return picked.length;
  });

/** Подтверждение пачкой: каждый кандидат — своим решением; ошибка одного не останавливает остальные. */
export const confirmDomRfCandidates = async (
  ids: readonly number[],
  actor: string,
): Promise<{ confirmed: number; failed: Array<{ id: number; error: string }> }> => {
  let confirmed = 0;
  const failed: Array<{ id: number; error: string }> = [];
  for (const id of ids) {
    try {
      await confirmDomRfCandidate(id, actor);
      confirmed += 1;
    } catch (err) {
      if (!(err instanceof DomRfCandidateError) && !(err instanceof DomRfTargetError)) throw err;
      failed.push({ id, error: err.message });
    }
  }
  return { confirmed, failed };
};
