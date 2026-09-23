// Лента публикаций о компании: что о ней вообще писали и что из этого взято в карточку.
//
// Зачем отдельно от /mentions. Старая лента читает таблицу `mentions`, а в неё пишет
// только legacy `pipeline/apply.ts`, заблокированный в коде (`pipeline/guard.ts`):
// на всём, что собрано новым конвейером, тот блок пуст. Здесь источник — публикации
// (`source_items`) и опубликованные утверждения, то есть ровно то, что портал знает
// сегодня; legacy-упоминания добавляются сверху, чтобы старая база не обеднела.
//
// Строка ленты — публикация, а не утверждение: одна статья с тремя фактами остаётся
// одной строкой. Тема (`revision_headlines`) показывается, когда у публикации нет
// заголовка, и остаётся подписью модели — не заголовком источника и не доказательством.

import { query } from '../db/pool.js';
import { keysetCursor, parseKeysetCursor } from '../utils/keysetCursor.js';

/** Что сказано о компании в этой публикации. Одна строка — одно опубликованное утверждение. */
export interface IPublicationFact {
  assertionId: number | null;
  predicate: string;
  role: string | null;
  eventType: string | null;
  modality: string | null;
  polarity: string | null;
  status: string | null;
  projectId: number | null;
  projectName: string | null;
  /** Вторая сторона связи: любая из сторон, кроме самой компании. */
  otherCompanyId: number | null;
  otherCompanyName: string | null;
  amount: string | null;
  currency: string | null;
  /** Назначение суммы словами подписывает фронт: иск и цена договора — разные числа. */
  valueType: string | null;
  /** Цитата из редакции. Подтверждает, что так написано, а не что это правда. */
  quote: string | null;
}

export interface IPublicationRow {
  itemId: number;
  revisionId: number;
  documentId: number | null;
  title: string | null;
  /** Тема, составленная локальной моделью: только когда заголовка нет. */
  topic: string | null;
  publishedAt: string | null;
  observedAt: string;
  sourceTitle: string;
  sourceKind: string;
  /** Ключ канала: пока имя не собрано (title = key), экран показывает «@ключ». */
  sourceKey: string;
  url: string | null;
  completeness: string;
  snippet: string;
  facts: IPublicationFact[];
  /** Сколько утверждений осталось за пределами показанных. */
  moreFacts: number;
}

/** Сколько утверждений показываем в строке ленты: остальное — на странице публикации. */
const FACTS_PER_ITEM = 3;

interface IItemRow {
  itemId: number;
  revisionId: number;
  documentId: number | null;
  title: string | null;
  topic: string | null;
  publishedAt: string | null;
  observedAt: string;
  sourceTitle: string;
  sourceKind: string;
  sourceKey: string;
  url: string | null;
  completeness: string;
  snippet: string;
  /** pg отдаёт timestamptz объектом Date: в курсор — только через keysetCursor. */
  sortAt: Date;
}

/**
 * Публикации, где компания названа стороной опубликованного утверждения, плюс
 * legacy-упоминания. Порядок — по дате публикации, а без неё по моменту наблюдения:
 * момент, когда портал увидел текст, датой публикации не притворяется.
 */
const ITEMS_SQL = `
  WITH touched AS (
    SELECT DISTINCT pa.source_item_id AS item_id
    FROM published_assertions_v pa
    WHERE pa.subject_company_id = $1 OR pa.object_company_id = $1 OR pa.counterparty_company_id = $1
    UNION
    SELECT DISTINCT r.source_item_id
    FROM mentions m
    JOIN document_revisions r ON r.legacy_document_id = m.document_id
    WHERE m.entity_kind = 'company' AND m.entity_id = $1
  )
  SELECT si.id AS "itemId",
         rev.id AS "revisionId",
         rev.legacy_document_id AS "documentId",
         rev.title,
         (SELECT h.topic FROM revision_headlines h
           WHERE h.revision_id = rev.id ORDER BY h.created_at DESC LIMIT 1) AS topic,
         si.published_at AS "publishedAt",
         si.first_observed_at AS "observedAt",
         s.title AS "sourceTitle",
         s.kind AS "sourceKind",
         s.key AS "sourceKey",
         coalesce(si.canonical_url, si.original_url) AS url,
         rev.completeness::text AS completeness,
         left(rev.body, 300) AS snippet,
         coalesce(si.published_at, si.first_observed_at) AS "sortAt"
  FROM touched t
  JOIN source_items si ON si.id = t.item_id
  JOIN sources s ON s.id = si.source_id
  JOIN LATERAL (
    SELECT r2.id, r2.title, r2.body, r2.completeness, r2.legacy_document_id
    FROM document_revisions r2
    WHERE r2.source_item_id = si.id
    ORDER BY r2.revision_no DESC
    LIMIT 1
  ) rev ON true
  WHERE ($3::timestamptz IS NULL
         OR (coalesce(si.published_at, si.first_observed_at), si.id) < ($3::timestamptz, $4::bigint))
  ORDER BY coalesce(si.published_at, si.first_observed_at) DESC, si.id DESC
  LIMIT $2`;

/** Утверждения этих публикаций, где компания — одна из сторон. */
const FACTS_SQL = `
  SELECT pa.source_item_id AS "itemId",
         pa.id AS "assertionId",
         pa.predicate,
         pa.role,
         pa.event_type AS "eventType",
         pa.modality::text AS modality,
         pa.polarity,
         pa.status::text AS status,
         coalesce(pa.object_project_id, pa.subject_project_id, pa.context_project_id) AS "projectId",
         p.name AS "projectName",
         CASE WHEN pa.subject_company_id <> $2::bigint THEN pa.subject_company_id
              WHEN pa.object_company_id IS NOT NULL AND pa.object_company_id <> $2::bigint THEN pa.object_company_id
              ELSE pa.counterparty_company_id END AS "otherCompanyId",
         CASE WHEN pa.subject_company_id <> $2::bigint THEN sc.name
              WHEN pa.object_company_id IS NOT NULL AND pa.object_company_id <> $2::bigint THEN oc.name
              ELSE cc.name END AS "otherCompanyName",
         pa.value_numeric::text AS amount,
         pa.value_currency AS currency,
         pa.value_type AS "valueType",
         (SELECT ev.quote FROM evidence ev
           WHERE ev.assertion_id = pa.id AND ev.status = 'active' ORDER BY ev.id LIMIT 1) AS quote
  FROM published_assertions_v pa
  LEFT JOIN projects p ON p.id = coalesce(pa.object_project_id, pa.subject_project_id, pa.context_project_id)
  LEFT JOIN companies sc ON sc.id = pa.subject_company_id
  LEFT JOIN companies oc ON oc.id = pa.object_company_id
  LEFT JOIN companies cc ON cc.id = pa.counterparty_company_id
  WHERE pa.source_item_id = ANY($1::bigint[])
    AND (pa.subject_company_id = $2::bigint OR pa.object_company_id = $2::bigint
         OR pa.counterparty_company_id = $2::bigint)
  ORDER BY pa.source_item_id, pa.id`;

/** Legacy-упоминания: старые данные, где утверждений ещё нет. */
const LEGACY_SQL = `
  SELECT DISTINCT ON (r.source_item_id, m.quote)
         r.source_item_id AS "itemId", m.role, m.quote
  FROM mentions m
  JOIN document_revisions r ON r.legacy_document_id = m.document_id
  WHERE m.entity_kind = 'company' AND m.entity_id = $2::bigint
    AND r.source_item_id = ANY($1::bigint[])
  ORDER BY r.source_item_id, m.quote, m.id`;

export const loadCompanyPublications = async (
  companyId: number,
  limit: number,
  cursor: string | undefined,
): Promise<{ items: IPublicationRow[]; nextCursor: string | null }> => {
  const [cursorAt, cursorId] = parseKeysetCursor(cursor);
  const items = await query<IItemRow>(ITEMS_SQL, [companyId, limit, cursorAt, cursorId]);
  if (items.length === 0) return { items: [], nextCursor: null };

  const ids = items.map(i => i.itemId);
  const facts = await query<IPublicationFact & { itemId: number }>(FACTS_SQL, [ids, companyId]);
  const legacy = await query<{ itemId: number; role: string | null; quote: string | null }>(LEGACY_SQL, [
    ids,
    companyId,
  ]);

  const byItem = new Map<number, IPublicationFact[]>();
  for (const fact of facts) {
    const { itemId, ...rest } = fact;
    byItem.set(itemId, [...(byItem.get(itemId) ?? []), rest]);
  }
  // Упоминание из старого разбора добавляется только там, где утверждений нет вовсе:
  // иначе один и тот же факт показался бы дважды разными словами.
  for (const row of legacy) {
    if (byItem.has(row.itemId)) continue;
    byItem.set(row.itemId, [
      {
        assertionId: null,
        predicate: 'company_mentioned',
        role: row.role,
        eventType: null,
        modality: null,
        polarity: null,
        status: 'legacy_unknown',
        projectId: null,
        projectName: null,
        otherCompanyId: null,
        otherCompanyName: null,
        amount: null,
        currency: null,
        valueType: null,
        quote: row.quote,
      },
    ]);
  }

  const rows: IPublicationRow[] = items.map(item => {
    const all = byItem.get(item.itemId) ?? [];
    const { sortAt: _sortAt, ...rest } = item;
    return { ...rest, facts: all.slice(0, FACTS_PER_ITEM), moreFacts: Math.max(0, all.length - FACTS_PER_ITEM) };
  });

  const last = items[items.length - 1];
  return {
    items: rows,
    nextCursor: items.length === limit && last ? keysetCursor(last.sortAt, last.itemId) : null,
  };
};
