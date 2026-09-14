// Идентичность сущностей (этап 04): слияние с предпросмотром и отменой, тип
// компании, типизированные реквизиты, явные связи, неоднозначные совпадения.
// Доступ — после входа оператора; изменяющие запросы — с CSRF (app.ts).

import type { Response } from 'express';
import { z } from 'zod';

import { query, withTransaction } from '../db/pool.js';
import { CanonWriteBlockedError, assertMergeAllowed } from '../pipeline/guard.js';
import {
  EntityVersionConflictError,
  MergeBlockedError,
  MergeIdempotencyMismatchError,
  MergeNotFoundError,
  UnsafeUndoError,
  applyEntityMerge,
  previewMerge,
} from '../resolve/entityMerge.js';
import { addIdentifier, classifyTaxId } from '../resolve/identifiers.js';
import { applyQueuedMerge, listMergeHistory, previewQueuedMerge, undoMerge } from '../resolve/merge.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const entitiesRouter = asyncRouter();

const idOf = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** Доменные ошибки слияния → HTTP. true — ответ отправлен. */
export const sendMergeError = (res: Response, err: unknown): boolean => {
  if (err instanceof CanonWriteBlockedError) {
    res.status(423).json({ error: err.reason, code: 'blocked' });
  } else if (err instanceof MergeBlockedError) {
    res.status(422).json({ error: err.message, code: 'merge_blocked', conflicts: err.conflicts });
  } else if (err instanceof EntityVersionConflictError) {
    res.status(409).json({ error: err.message, code: 'version_conflict', current: err.current });
  } else if (err instanceof MergeIdempotencyMismatchError) {
    res.status(422).json({ error: err.message, code: 'idempotency_mismatch' });
  } else if (err instanceof UnsafeUndoError) {
    res.status(409).json({ error: err.message, code: 'unsafe_undo', plan: err.plan });
  } else if (err instanceof MergeNotFoundError) {
    res.status(404).json({ error: err.message });
  } else {
    return false;
  }
  return true;
};

const kindSchema = z.enum(['company', 'project']);

entitiesRouter.get('/entities/merge-preview', async (req, res) => {
  const parsed = z
    .object({ kind: kindSchema, sourceId: z.coerce.number().int().positive(), targetId: z.coerce.number().int().positive() })
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Укажите kind, sourceId и targetId' });
    return;
  }
  try {
    res.json(await previewMerge(parsed.data.kind, parsed.data.sourceId, parsed.data.targetId));
  } catch (err) {
    if (!sendMergeError(res, err)) throw err;
  }
});

const versionsSchema = z.object({
  expectedSourceVersion: z.number().int().positive(),
  expectedTargetVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(200),
  reason: z.string().trim().max(2000).nullish(),
});

entitiesRouter.post('/entities/merge', async (req, res) => {
  const parsed = versionsSchema
    .extend({ kind: kindSchema, sourceId: z.number().int().positive(), targetId: z.number().int().positive() })
    .safeParse(req.body);
  try {
    assertMergeAllowed();
    if (!parsed.success) {
      res.status(400).json({ error: 'Некорректный запрос слияния' });
      return;
    }
    const result = await applyEntityMerge({ ...parsed.data, reason: parsed.data.reason ?? null, actor: 'operator' });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    if (!sendMergeError(res, err)) throw err;
  }
});

entitiesRouter.get('/admin/merges/:id/preview', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  try {
    res.json(await previewQueuedMerge(id));
  } catch (err) {
    if (!sendMergeError(res, err)) throw err;
  }
});

entitiesRouter.post('/admin/merges/:id/merge', async (req, res) => {
  const id = idOf(req.params.id);
  try {
    // Флаг — до разбора тела: выключенная операция отвечает 423 и ничего не читает из БД.
    assertMergeAllowed();
    const parsed = versionsSchema.safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Нужны версии из предпросмотра и ключ идемпотентности' });
      return;
    }
    const result = await applyQueuedMerge({ queueId: id, actor: 'operator', ...parsed.data, reason: parsed.data.reason ?? null });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    if (!sendMergeError(res, err)) throw err;
  }
});

entitiesRouter.get('/entities/merges', async (_req, res) => {
  res.json({ items: await listMergeHistory() });
});

entitiesRouter.post('/entities/merges/:id/undo', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = z.object({ idempotencyKey: z.string().min(8).max(200) }).safeParse(req.body);
  try {
    assertMergeAllowed();
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Нужен ключ идемпотентности' });
      return;
    }
    res.json(await undoMerge(id, 'operator', parsed.data.idempotencyKey));
  } catch (err) {
    if (!sendMergeError(res, err)) throw err;
  }
});

// ---------------------------------------------------------------------------
// Тип компании, реквизиты, связи

entitiesRouter.patch('/entities/companies/:id/type', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = z
    .object({ entityType: z.enum(['legal_entity', 'brand', 'group', 'unknown']), expectedVersion: z.number().int().positive() })
    .safeParse(req.body);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Некорректный тип' });
    return;
  }
  const updated = await query<{ id: number; version: number }>(
    `UPDATE companies SET entity_type = $2, version = version + 1, updated_at = now()
     WHERE id = $1 AND version = $3 AND merged_into_id IS NULL RETURNING id, version`,
    [id, parsed.data.entityType, parsed.data.expectedVersion],
  );
  if (updated.length === 0) {
    res.status(409).json({ error: 'Компания изменилась или слита. Обновите карточку.', code: 'version_conflict' });
    return;
  }
  res.json(updated[0]);
});

entitiesRouter.post('/entities/companies/:id/identifiers', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = z
    .object({ value: z.string().trim().min(10).max(20), note: z.string().trim().max(500).nullish() })
    .safeParse(req.body);
  const typed = parsed.success ? classifyTaxId(parsed.data.value) : null;
  if (id === null || !typed) {
    res.status(400).json({ error: 'Укажите ИНН (10/12 цифр), ОГРН (13) или ОГРНИП (15)' });
    return;
  }
  const outcome = await withTransaction(async client => {
    const owner = (
      await client.query<{ company_id: number }>(
        `SELECT company_id FROM entity_identifiers
         WHERE jurisdiction = $1 AND identifier_type = $2 AND value = $3 AND status = 'active'`,
        [typed.jurisdiction, typed.identifierType, typed.value],
      )
    ).rows[0];
    if (owner && owner.company_id !== id) return { conflict: owner.company_id };
    const sameType = (
      await client.query<{ value: string }>(
        `SELECT value FROM entity_identifiers WHERE company_id = $1 AND jurisdiction = $2 AND identifier_type = $3 AND status = 'active'`,
        [id, typed.jurisdiction, typed.identifierType],
      )
    ).rows[0];
    if (sameType && sameType.value !== typed.value) return { sameTypeConflict: sameType.value };
    await addIdentifier(client, { ...typed, companyId: id, origin: 'manual', createdBy: 'operator' });
    return { ok: true };
  });
  if ('conflict' in outcome) {
    res.status(409).json({ error: `Реквизит уже принадлежит компании #${outcome.conflict}`, code: 'identifier_taken' });
  } else if ('sameTypeConflict' in outcome) {
    res.status(409).json({ error: 'У компании уже есть другой реквизит этого типа', code: 'identifier_conflict' });
  } else {
    res.status(201).json({ ok: true, identifier: typed });
  }
});

entitiesRouter.post('/entities/relations', async (req, res) => {
  const parsed = z
    .object({
      fromCompanyId: z.number().int().positive(),
      toCompanyId: z.number().int().positive(),
      relationType: z.enum(['brand_of', 'member_of_group', 'successor_of']),
      status: z.enum(['candidate', 'confirmed', 'rejected']).default('confirmed'),
      note: z.string().trim().max(2000).nullish(),
    })
    .safeParse(req.body);
  if (!parsed.success || parsed.data.fromCompanyId === parsed.data.toCompanyId) {
    res.status(400).json({ error: 'Некорректная связь' });
    return;
  }
  const d = parsed.data;
  const rows = await query<{ id: number }>(
    `INSERT INTO company_relations (from_company_id, to_company_id, relation_type, status, note, created_by, decided_by, decided_at)
     VALUES ($1, $2, $3, $4, $5, 'operator', 'operator', now())
     ON CONFLICT (from_company_id, to_company_id, relation_type)
     DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, decided_by = 'operator', decided_at = now()
     RETURNING id`,
    [d.fromCompanyId, d.toCompanyId, d.relationType, d.status, d.note ?? null],
  );
  res.status(201).json({ id: rows[0]?.id });
});

entitiesRouter.get('/entities/ambiguities', async (_req, res) => {
  const items = await query(
    `SELECT id, entity_kind AS "entityKind", surface, candidate_ids AS "candidateIds", revision_id AS "revisionId",
            occurrences, created_at AS "createdAt"
     FROM resolution_ambiguities WHERE status = 'open' ORDER BY updated_at DESC LIMIT 100`,
  );
  res.json({ items });
});
