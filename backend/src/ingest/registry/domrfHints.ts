// Подсказка модели к найденному в реестре застройщиков ДОМ.РФ (этап 20D, шаг 3, миграция 038).
//
// Поиск по названию даёт несколько застройщиков и групп; инженер решает «это он / не он». Модель видит то же,
// что инженер, — компанию портала (вид, ИНН, роли, объекты) и запись реестра (вид, название, строки выдачи,
// реквизиты и объекты, если страницу уже прочитали) — и подсказывает: «скорее он», «скорее не он», «не уверена».
// Подсказка не решение: состояние совпадения меняет только оператор, в канон она не попадает.
//
// Допуск — ИИ-обработка источника наш.дом.рф (ingest/policy.ts): проверяется до прохода и после каждого ответа.
// Идёт тем же заданием, что разбор и темы: два параллельных запроса к локальной модели делят VRAM.

import { env } from '../../config/env.js';
import { query, queryOne } from '../../db/pool.js';
import { extractDomRfHint, type ILlmResult } from '../../llm/client.js';
import { DOMRF_HINT_PROMPT_VERSION, formatDomRfHintInput, type IDomRfHintInput } from '../../llm/domrfHint/prompt.js';
import type { DomRfHintVerdict, IDomRfHint } from '../../llm/domrfHint/schema.js';
import { evaluateSourcePolicy } from '../policy.js';
import { getSourceByKey } from '../sources.js';
import { DOMRF_HOST, type DomRfCardKind } from './domrfCards.js';

/** Объектов в запросе с каждой стороны: для сравнения хватает, и вызов остаётся коротким. */
const PROJECTS_MAX = 10;

export interface IDomRfHintPermission {
  sourceId: number | null;
  allowed: boolean;
  reason: string | null;
}

/** Разрешена ли ИИ-обработка источника наш.дом.рф — без неё модель записей реестра не видит. */
export const domRfHintPermission = async (): Promise<IDomRfHintPermission> => {
  const source = await getSourceByKey('website', DOMRF_HOST);
  if (!source) return { sourceId: null, allowed: false, reason: 'источник наш.дом.рф не зарегистрирован' };
  const decision = evaluateSourcePolicy(source, 'ai_processing');
  return { sourceId: source.id, allowed: decision.allowed, reason: decision.allowed ? null : (decision.reason ?? 'ИИ-обработка не разрешена') };
};

/** Совпадения, ждущие решения, без подсказки нынешней модели и версии промпта. */
export const linksToHint = async (limit: number): Promise<number[]> =>
  (
    await query<{ id: number }>(
      `SELECT l.id FROM domrf_company_links l
       JOIN companies c ON c.id = l.company_id AND c.merged_into_id IS NULL
       WHERE l.state = 'pending'
         AND (l.hint_model IS DISTINCT FROM $2 OR l.hint_prompt_version IS DISTINCT FROM $3)
       ORDER BY l.id
       LIMIT $1`,
      [limit, env.LMSTUDIO_MODEL, DOMRF_HINT_PROMPT_VERSION],
    )
  ).map(row => row.id);

interface ILinkRow {
  kind: DomRfCardKind;
  external_ref: string;
  name: string | null;
  details: string | null;
  company_id: number;
  company_name: string;
  entity_type: string;
  tax_id: string | null;
  inn: string | null;
  group_name: string | null;
}

/** Всё, что видит инженер в строке совпадения, — текстом для модели. */
export const loadDomRfHintInput = async (linkId: number): Promise<IDomRfHintInput | null> => {
  const link = await queryOne<ILinkRow>(
    `SELECT l.kind, l.external_ref, l.name, l.details, c.id AS company_id, c.name AS company_name, c.entity_type,
            (SELECT ei.value FROM entity_identifiers ei
              WHERE ei.company_id = c.id AND ei.status = 'active' AND ei.validation_status = 'checksum_valid'
                AND ei.identifier_type IN ('inn', 'ogrn')
              ORDER BY (ei.identifier_type = 'inn') DESC, ei.id LIMIT 1) AS tax_id,
            d.inn, d.group_name
     FROM domrf_company_links l
     JOIN companies c ON c.id = l.company_id
     LEFT JOIN domrf_cards d ON d.kind = l.kind AND d.external_ref = l.external_ref
     WHERE l.id = $1`,
    [linkId],
  );
  if (!link) return null;
  const participations = await query<{ role: string; name: string; city: string | null }>(
    `SELECT DISTINCT pp.role, p.name, p.city
     FROM card_participations_v pp
     JOIN projects p ON p.id = pp.project_id AND p.merged_into_id IS NULL
     WHERE pp.company_id = $1 AND pp.is_current
     ORDER BY p.name
     LIMIT 50`,
    [link.company_id],
  );
  const objects = await query<{ label: string | null; details: string | null }>(
    `SELECT label, details FROM domrf_candidates WHERE found_via_kind = $1 AND found_via_ref = $2
     ORDER BY label NULLS LAST, external_ref::bigint LIMIT $3`,
    [link.kind, link.external_ref, PROJECTS_MAX],
  );
  const projects = [...new Set(participations.map(p => (p.city ? `${p.name} — ${p.city}` : p.name)))].slice(0, PROJECTS_MAX);
  return {
    company: {
      name: link.company_name,
      entityType: link.entity_type,
      taxId: link.tax_id,
      roles: [...new Set(participations.map(p => p.role))],
      projects,
    },
    record: {
      kind: link.kind,
      name: link.name,
      details: link.details,
      inn: link.inn,
      groupName: link.group_name,
      objects: objects.map(o => [o.label, o.details].filter(Boolean).join(' · ')).filter(text => text !== ''),
    },
  };
};

const saveHint = async (linkId: number, hint: IDomRfHint): Promise<void> => {
  await query(
    `UPDATE domrf_company_links SET hint_verdict = $2, hint_reason = $3, hint_error = NULL, hint_model = $4,
       hint_prompt_version = $5, hinted_at = now()
     WHERE id = $1`,
    [linkId, hint.verdict, hint.reason, env.LMSTUDIO_MODEL, DOMRF_HINT_PROMPT_VERSION],
  );
};

/** Ответ не разобран: подсказки нет, причина на строке; при той же конфигурации не повторяется. */
const saveHintError = async (linkId: number, error: string): Promise<void> => {
  await query(
    `UPDATE domrf_company_links SET hint_verdict = NULL, hint_reason = NULL, hint_error = $2, hint_model = $3,
       hint_prompt_version = $4, hinted_at = now()
     WHERE id = $1`,
    [linkId, error.slice(0, 500), env.LMSTUDIO_MODEL, DOMRF_HINT_PROMPT_VERSION],
  );
};

/** Вызов модели — параметром: тест подставляет свой и проверяет, что без допуска модель не зовут вовсе. */
export type DomRfHintCaller = (body: string) => Promise<ILlmResult<IDomRfHint>>;

// Две фразы, а не текст: большой лимит токенов только продлевает ожидание.
const defaultCaller: DomRfHintCaller = body => extractDomRfHint({ body, publishedAt: null, maxTokens: 300 });

export type DomRfHintOutcome =
  | { linkId: number; outcome: 'saved'; verdict: DomRfHintVerdict }
  | { linkId: number; outcome: 'invalid'; reason: string }
  | { linkId: number; outcome: 'model_error'; reason: string }
  | { linkId: number; outcome: 'refused_policy'; reason: string };

/**
 * Один проход. Модель не отвечает — проход останавливается: следующие ответы не придут тоже, а каждая
 * попытка — три захода с паузами. Ответ не по схеме — пометка на строке, проход идёт дальше. Допуск
 * отозван, пока модель отвечала, — ответ не сохраняется, проход останавливается.
 */
export const runDomRfHintPass = async (
  limit = env.DOMRF_HINT_BATCH_SIZE,
  caller: DomRfHintCaller = defaultCaller,
): Promise<DomRfHintOutcome[]> => {
  if (!env.DOMRF_HINT_ENABLED) return [];
  if (!(await domRfHintPermission()).allowed) return [];
  const results: DomRfHintOutcome[] = [];
  for (const linkId of await linksToHint(limit)) {
    const input = await loadDomRfHintInput(linkId);
    if (!input) continue;
    let result: ILlmResult<IDomRfHint>;
    try {
      result = await caller(formatDomRfHintInput(input));
    } catch (err) {
      results.push({ linkId, outcome: 'model_error', reason: err instanceof Error ? err.message : String(err) });
      break;
    }
    if (!result.ok && result.failure === 'llm_error') {
      results.push({ linkId, outcome: 'model_error', reason: result.message });
      break;
    }
    const after = await domRfHintPermission();
    if (!after.allowed) {
      results.push({ linkId, outcome: 'refused_policy', reason: after.reason ?? 'ИИ-обработка не разрешена' });
      break;
    }
    if (!result.ok) {
      const reason = `${result.failure}: ${result.message}`;
      await saveHintError(linkId, reason);
      results.push({ linkId, outcome: 'invalid', reason });
      continue;
    }
    await saveHint(linkId, result.data);
    results.push({ linkId, outcome: 'saved', verdict: result.data.verdict });
  }
  return results;
};

export interface IDomRfHintCounts {
  /** Ждут решения и уже с подсказкой нынешней модели. */
  hinted: number;
  /** Ждут решения, подсказки ещё нет. */
  waiting: number;
}

export const domRfHintCounts = async (): Promise<IDomRfHintCounts> =>
  (await queryOne<IDomRfHintCounts>(
    `SELECT count(*) FILTER (WHERE l.hint_model = $1 AND l.hint_prompt_version = $2)::int AS hinted,
            count(*) FILTER (WHERE l.hint_model IS DISTINCT FROM $1 OR l.hint_prompt_version IS DISTINCT FROM $2)::int AS waiting
     FROM domrf_company_links l JOIN companies c ON c.id = l.company_id AND c.merged_into_id IS NULL
     WHERE l.state = 'pending'`,
    [env.LMSTUDIO_MODEL, DOMRF_HINT_PROMPT_VERSION],
  )) ?? { hinted: 0, waiting: 0 };
