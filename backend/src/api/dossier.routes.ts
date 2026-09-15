// Рабочее досье (этап 08A): обращения, досье обращения, объекта и резюме компании.
// Доступ — после входа оператора; изменяющие запросы — с CSRF (app.ts). Модель не вызывается.

import { z } from 'zod';

import { getPool, query } from '../db/pool.js';
import {
  CaseNotFoundError,
  CaseVersionConflictError,
  caseHistory,
  createCase,
  createCaseSchema,
  getCase,
  listCases,
  updateCase,
  updateCaseSchema,
} from '../dossier/cases.js';
import { loadCompanySummary } from '../dossier/companySummary.js';
import { loadCaseDossier } from '../dossier/load.js';
import { loadProjectDossier } from '../dossier/projectDossier.js';
import { normalizeName } from '../resolve/normalize.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const dossierRouter = asyncRouter();

const idOf = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const firstIssue = (err: z.ZodError): string => err.issues[0]?.message ?? 'Некорректные данные';

const sendCaseError = (res: import('express').Response, err: unknown): boolean => {
  if (err instanceof CaseVersionConflictError) {
    res.status(409).json({ error: err.message, code: 'version_conflict', currentVersion: err.currentVersion });
    return true;
  }
  if (err instanceof CaseNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  return false;
};

const listSchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

dossierRouter.get('/cases', async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  res.json(await listCases({ status: parsed.data.status ?? null, before: parsed.data.before ?? null, limit: parsed.data.limit }));
});

dossierRouter.post('/cases', async (req, res) => {
  const parsed = createCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error), code: 'invalid' });
    return;
  }
  try {
    const result = await createCase(parsed.data, 'operator');
    res.status(result.replayed ? 200 : 201).json({ case: result.row, replayed: result.replayed });
  } catch (err) {
    if (!sendCaseError(res, err)) throw err;
  }
});

dossierRouter.get('/cases/:id', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const row = await getCase(getPool(), id);
  if (!row) {
    res.status(404).json({ error: 'Обращение не найдено' });
    return;
  }
  res.setHeader('ETag', `"v${row.version}"`);
  res.json({ case: row, history: (await caseHistory(id)).slice(0, 20) });
});

dossierRouter.put('/cases/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = updateCaseSchema.safeParse(req.body);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Некорректный id' : firstIssue(parsed.error), code: 'invalid' });
    return;
  }
  try {
    const row = await updateCase(id, parsed.data, 'operator');
    res.setHeader('ETag', `"v${row.version}"`);
    res.json({ case: row });
  } catch (err) {
    if (!sendCaseError(res, err)) throw err;
  }
});

/** Досье обращения: строится при открытии из сохранённых данных, без модели. */
dossierRouter.get('/cases/:id/dossier', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const dossier = await loadCaseDossier(getPool(), id);
  if (!dossier) {
    res.status(404).json({ error: 'Обращение не найдено' });
    return;
  }
  res.json(dossier);
});

const projectSearchSchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Поиск объекта: город, уровень (комплекс/очередь/корпус) и родитель — чтобы выбрать нужный, а не первый. */
dossierRouter.get('/projects/search', async (req, res) => {
  const parsed = projectSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Укажите q длиной от 2 символов' });
    return;
  }
  const normalized = normalizeName(parsed.data.q, 'project');
  const items = await query(
    `SELECT p.id, p.name, p.city, p.kind, p.project_level AS level, p.level_label AS "levelLabel",
            pp.id AS "parentId", pp.name AS "parentName",
            (SELECT count(*)::int FROM projects ch WHERE ch.parent_project_id = p.id AND ch.merged_into_id IS NULL) AS children,
            similarity(p.name_latin, $1) AS score
     FROM projects p LEFT JOIN projects pp ON pp.id = p.parent_project_id
     WHERE p.merged_into_id IS NULL
       AND (p.name_latin % $1 OR ($2 <> '' AND p.name_key LIKE $2 || '%')
            OR EXISTS (SELECT 1 FROM entity_aliases a WHERE a.entity_kind = 'project' AND a.entity_id = p.id AND a.alias_latin % $1))
     ORDER BY score DESC, p.name, p.id
     LIMIT $3`,
    [normalized.latin, normalized.key, parsed.data.limit],
  );
  res.json({ items });
});

const periodSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

dossierRouter.get('/projects/:id/dossier', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = periodSchema.safeParse(req.query);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  const dossier = await loadProjectDossier(getPool(), id, { from: parsed.data.from ?? null, to: parsed.data.to ?? null });
  if (!dossier) {
    res.status(404).json({ error: 'Объект не найден' });
    return;
  }
  res.json(dossier);
});

dossierRouter.get('/companies/:id/dossier-summary', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  res.json(await loadCompanySummary(getPool(), id));
});
