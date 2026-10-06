// Проекты со страниц сайта компании (этап 25B, ADR-018): модель site-projects@1 по последнему снимку каждой
// страницы, проверка цитат — как у разбора публикаций (pipeline/verify.ts), запись — строкой на (страница, модель,
// промпт), строки не правятся. Это сведения самой компании на дату: в канон ничего не идёт.
//
// Образец — темы публикаций (headline/service.ts): ИИ-допуск источника проверяется до вызова и после ответа;
// сбой связи строки не оставляет и останавливает проход (следующий тик повторит), ответ не по схеме — строкой
// invalid_answer, чтобы та же страница той же моделью не разбиралась по кругу.

import { env } from '../config/env.js';
import { execute, query } from '../db/pool.js';
import { approvedPolicySql, evaluateSourcePolicy } from '../ingest/policy.js';
import { getSourceById } from '../ingest/sources.js';
import { extractSiteProjects, type ILlmResult } from '../llm/client.js';
import { SITE_PROJECTS_PROMPT_VERSION, formatSiteProjectsInput } from '../llm/siteProjects/prompt.js';
import { SITE_PROJECTS_SCHEMA_VERSION, type ISiteProject, type ISiteProjects } from '../llm/siteProjects/schema.js';
import { isAddressGroundedInBody, isCityMentionedInBody, isNameInQuote, isQuoteVerbatim } from '../pipeline/verify.js';
import { normalizeName } from '../resolve/normalize.js';

export interface IPageToExtract {
  id: number;
  sourceId: number;
  url: string;
  title: string | null;
  text: string;
}

/** Последний снимок каждой страницы допущенного к ИИ сайта компании, ещё не разобранный этой моделью и промптом. */
export const pagesToExtract = async (limit: number): Promise<IPageToExtract[]> =>
  query<IPageToExtract>(
    `SELECT p.id, p.source_id AS "sourceId", p.url, p.title, p.text
     FROM company_site_pages p
     JOIN sources s ON s.id = p.source_id
     WHERE s.config->>'mode' = 'company_site' AND ${approvedPolicySql('s', 'ai_processing')}
       AND NOT EXISTS (
         SELECT 1 FROM company_site_pages n
         WHERE n.source_id = p.source_id AND n.url = p.url AND (n.fetched_at, n.id) > (p.fetched_at, p.id))
       AND NOT EXISTS (
         SELECT 1 FROM company_site_extractions e WHERE e.page_id = p.id AND e.model = $2 AND e.prompt_version = $3)
     ORDER BY p.fetched_at DESC, p.id DESC
     LIMIT $1`,
    [limit, env.LMSTUDIO_MODEL, SITE_PROJECTS_PROMPT_VERSION],
  );

/** Ключ проекта для дублей и сравнения с порталом: «ЖК «Остров»» и «Остров» — один ключ. */
export const projectKey = (name: string): string => normalizeName(name, 'project').key;

const flat = (value: string): string => value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/**
 * Проверка ответа модели по тексту страницы: цитата дословно есть на странице, название — внутри цитаты (с «ЖК»
 * или без), ключ названия не пустой; дубли по ключу — один раз. Город, адрес и срок остаются, только если они
 * написаны на странице, иначе — null (модель могла их «знать», а не прочитать).
 */
export const verifySiteProjects = (projects: readonly ISiteProject[], text: string): { accepted: ISiteProject[]; rejected: number } => {
  const accepted: ISiteProject[] = [];
  const keys = new Set<string>();
  let rejected = 0;
  const body = flat(text);
  for (const p of projects) {
    const key = projectKey(p.name);
    const display = normalizeName(p.name, 'project').display;
    const named = isNameInQuote(p.name, p.quote) || (display !== '' && isNameInQuote(display, p.quote));
    if (key.length < 2 || !isQuoteVerbatim(p.quote, text) || !named) {
      rejected += 1;
      continue;
    }
    if (keys.has(key)) continue;
    keys.add(key);
    accepted.push({
      ...p,
      city: p.city && isCityMentionedInBody(p.city, text) ? p.city : null,
      address: p.address && isAddressGroundedInBody(p.address, text) ? p.address : null,
      completion: p.completion && body.includes(flat(p.completion)) ? p.completion : null,
    });
  }
  return { accepted, rejected };
};

export type SiteProjectsCaller = (input: { body: string; publishedAt: Date | null }) => Promise<ILlmResult<ISiteProjects>>;

const defaultCaller: SiteProjectsCaller = input => extractSiteProjects({ body: input.body, publishedAt: input.publishedAt });

export type SiteProjectsOutcome = 'saved' | 'invalid_answer' | 'refused_policy' | 'model_error' | 'disabled';

export interface ISiteProjectsRun {
  pageId: number;
  url: string;
  outcome: SiteProjectsOutcome;
  projects: number;
  rejected: number;
  reason: string | null;
}

const aiAllowed = async (sourceId: number): Promise<{ allowed: boolean; reason: string | null }> => {
  const source = await getSourceById(sourceId);
  if (!source) return { allowed: false, reason: 'источник удалён' };
  const decision = evaluateSourcePolicy(source, 'ai_processing');
  return { allowed: decision.allowed, reason: decision.allowed ? null : (decision.reason ?? 'ИИ-обработка не разрешена') };
};

export interface IExtractionRow {
  outcome: 'ok' | 'invalid_answer';
  projects: ISiteProject[];
  rejected: number;
  inputChars: number;
  truncated: boolean;
  error: string | null;
}

const saveExtraction = async (page: IPageToExtract, row: IExtractionRow): Promise<void> => {
  await execute(
    `INSERT INTO company_site_extractions (page_id, model, prompt_version, schema_version, outcome, projects, rejected_count, input_chars, truncated, error)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
     ON CONFLICT (page_id, model, prompt_version) DO NOTHING`,
    [
      page.id,
      env.LMSTUDIO_MODEL,
      SITE_PROJECTS_PROMPT_VERSION,
      SITE_PROJECTS_SCHEMA_VERSION,
      row.outcome,
      JSON.stringify(row.projects),
      row.rejected,
      row.inputChars,
      row.truncated,
      row.error?.slice(0, 1000) ?? null,
    ],
  );
};

/** Зависимости прохода за интерфейсом: логика допуска, повторов и записи проверяется без базы и модели. */
export interface ISiteProjectsDeps {
  list: (limit: number) => Promise<IPageToExtract[]>;
  caller: SiteProjectsCaller;
  allowed: (sourceId: number) => Promise<{ allowed: boolean; reason: string | null }>;
  save: (page: IPageToExtract, row: IExtractionRow) => Promise<void>;
}

export const SITE_PROJECTS_PG_DEPS: ISiteProjectsDeps = { list: pagesToExtract, caller: defaultCaller, allowed: aiAllowed, save: saveExtraction };

/** Проход: не больше `limit` страниц, по одной; сбой связи — стоп до следующего тика. */
export const runSiteProjectsPass = async (limit = env.SITE_PROJECTS_BATCH_SIZE, deps: ISiteProjectsDeps = SITE_PROJECTS_PG_DEPS): Promise<ISiteProjectsRun[]> => {
  if (!env.SITE_PROJECTS_ENABLED) return [];
  const { list, caller, allowed, save } = deps;
  const runs: ISiteProjectsRun[] = [];
  for (const page of await list(limit)) {
    const run = (outcome: SiteProjectsOutcome, extra: Partial<ISiteProjectsRun> = {}): ISiteProjectsRun => ({
      pageId: page.id,
      url: page.url,
      outcome,
      projects: 0,
      rejected: 0,
      reason: null,
      ...extra,
    });
    const before = await allowed(page.sourceId);
    if (!before.allowed) {
      runs.push(run('refused_policy', { reason: before.reason }));
      continue;
    }
    const chars = Array.from(page.text);
    const text = chars.slice(0, env.SITE_PROJECTS_INPUT_CHARS).join('');
    const truncated = chars.length > env.SITE_PROJECTS_INPUT_CHARS;
    let result: ILlmResult<ISiteProjects>;
    try {
      result = await caller({ body: formatSiteProjectsInput({ url: page.url, title: page.title, text }), publishedAt: null });
    } catch (err) {
      runs.push(run('model_error', { reason: err instanceof Error ? err.message : String(err) }));
      break;
    }
    // Допуск отозвали, пока модель думала: ответ не записывается.
    const after = await allowed(page.sourceId);
    if (!after.allowed) {
      runs.push(run('refused_policy', { reason: after.reason }));
      continue;
    }
    if (!result.ok) {
      if (result.failure === 'llm_error') {
        runs.push(run('model_error', { reason: result.message }));
        break;
      }
      await save(page, { outcome: 'invalid_answer', projects: [], rejected: 0, inputChars: text.length, truncated, error: result.message });
      runs.push(run('invalid_answer', { reason: result.message }));
      continue;
    }
    // Проверка — по тому тексту, который видела модель: хвоста за пределом она не читала.
    const checked = verifySiteProjects(result.data.projects, text);
    await save(page, {
      outcome: 'ok',
      projects: checked.accepted,
      rejected: checked.rejected,
      inputChars: text.length,
      truncated: truncated || Boolean(result.truncatedInput),
      error: null,
    });
    runs.push(run('saved', { projects: checked.accepted.length, rejected: checked.rejected }));
  }
  return runs;
};
