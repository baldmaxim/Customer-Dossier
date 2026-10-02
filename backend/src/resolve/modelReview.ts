// Разбор пар «возможный дубль» моделью (02.10.2026, решение владельца; ADR-005 дополнение).
//
// Очередь слияния копила сотни пар, которые никто не разбирал, и каталог показывал по три «Донстроя».
// Теперь каждую пару оценивает модель (entity-match@1): same / different / unsure с причиной. Вердикт
// пишется рядом с парой (merge_queue.model_*) и виден в «Проверка → Дубли». С MODEL_REVIEW_APPLY он
// применяется:
//   - same — слияние через entityMerge (предпросмотр, версии, токен, журнал, отмена) от имени модели,
//     только при MERGE_APPLY_ENABLED и если предпросмотр не находит препятствий (canApply);
//   - different — пара отклонена, причина — в decision_note;
//   - unsure — пара ждёт оператора.
// Правила раньше модели: разные ИНН/ОГРН (identifier_conflict) — different без вызова; две разные записи
// ДОМ.РФ у объектов — different без вызова. Направление слияния — к карточке с реквизитами или сведениями
// ДОМ.РФ: иначе ИНН ушёл бы в карточку, которую слили.

import { randomUUID } from 'node:crypto';

import { env } from '../config/env.js';
import { query, queryOne } from '../db/pool.js';
import { extractEntityMatch, type ILlmResult } from '../llm/client.js';
import { ENTITY_MATCH_PROMPT_VERSION, formatEntityMatchInput, type IEntityCard } from '../llm/entityMatch/prompt.js';
import type { EntityMatchVerdict, IEntityMatch } from '../llm/entityMatch/schema.js';
import { MergeNotFoundError, applyEntityMerge, previewMerge, type IEntitySummary, type IMergePreview } from './entityMerge.js';

/** Кто решил: модель с именем — в истории слияний и в решениях по паре видно, что это не оператор. */
export const modelActor = (): string => `model:${env.LMSTUDIO_MODEL}`;

const ENTITY_TYPE_WORDS: Record<string, string> = { legal_entity: 'юрлицо', group: 'группа компаний', brand: 'бренд' };
const LEVEL_WORDS: Record<string, string> = { complex: 'комплекс', phase: 'очередь', building: 'корпус' };
const ROLE_WORDS: Record<string, string> = {
  customer: 'заказчик',
  developer: 'застройщик',
  general_contractor: 'генподрядчик',
  contractor: 'подрядчик',
  subcontractor: 'субподрядчик',
  supplier: 'поставщик',
  designer: 'проектировщик',
  investor: 'инвестор',
  operator: 'эксплуатация',
};

/** Объектов и участников в карточке: для сравнения хватает, вызов остаётся коротким. */
const LIST_MAX = 10;

interface IPairRow {
  id: number;
  entity_kind: 'company' | 'project';
  source_entity_id: number;
  target_entity_id: number;
}

/** Пары, ждущие решения, без вердикта нынешней модели и версии промпта; обе сущности не слиты. */
export const pairsToJudge = async (limit: number): Promise<IPairRow[]> =>
  query<IPairRow>(
    `SELECT q.id, q.entity_kind, q.source_entity_id, q.target_entity_id
     FROM merge_queue q
     LEFT JOIN companies cs ON q.entity_kind = 'company' AND cs.id = q.source_entity_id
     LEFT JOIN companies ct ON q.entity_kind = 'company' AND ct.id = q.target_entity_id
     LEFT JOIN projects ps ON q.entity_kind = 'project' AND ps.id = q.source_entity_id
     LEFT JOIN projects pt ON q.entity_kind = 'project' AND pt.id = q.target_entity_id
     WHERE q.status = 'pending'
       AND coalesce(cs.id, ps.id) IS NOT NULL AND coalesce(ct.id, pt.id) IS NOT NULL
       AND coalesce(cs.merged_into_id, ps.merged_into_id) IS NULL
       AND coalesce(ct.merged_into_id, pt.merged_into_id) IS NULL
       AND (q.model_name IS DISTINCT FROM $2 OR q.model_prompt_version IS DISTINCT FROM $3)
     ORDER BY q.score DESC, q.id
     LIMIT $1`,
    [limit, env.LMSTUDIO_MODEL, ENTITY_MATCH_PROMPT_VERSION],
  );

const listLine = (title: string, items: string[]): string[] =>
  items.length === 0 ? [`${title}: нет сведений`] : [`${title}:`, ...items.map(item => `  - ${item}`)];

const summaryLines = (s: IEntitySummary, kind: 'company' | 'project'): string[] => {
  const lines = [`Название: ${s.name}`];
  if (kind === 'company') {
    lines.push(`Форма: ${s.legalForm ?? 'не указана'}`);
    lines.push(`Вид: ${s.entityType ? (ENTITY_TYPE_WORDS[s.entityType] ?? 'не установлен') : 'не установлен'}`);
    lines.push(`Реквизиты: ${s.identifiers.length > 0 ? s.identifiers.map(i => `${i.type.toUpperCase()} ${i.value}`).join(', ') : 'неизвестны'}`);
  } else {
    lines.push(`Уровень: ${s.projectLevel ? (LEVEL_WORDS[s.projectLevel] ?? s.projectLevel) : 'не указан'}`);
  }
  lines.push(`Город: ${s.city ?? 'неизвестен'}`);
  const aliases = s.aliases.filter(a => a !== s.name).slice(0, 5);
  if (aliases.length > 0) lines.push(`Другие написания: ${aliases.join(' · ')}`);
  return lines;
};

const companyExtras = async (companyId: number): Promise<string[]> => {
  const objects = await query<{ name: string; city: string | null; role: string }>(
    `SELECT DISTINCT p.name, p.city, pp.role
     FROM card_participations_v pp JOIN projects p ON p.id = pp.project_id AND p.merged_into_id IS NULL
     WHERE pp.company_id = $1
     ORDER BY p.name LIMIT $2`,
    [companyId, LIST_MAX],
  );
  const groups = await query<{ name: string; direction: string }>(
    `SELECT DISTINCT c.name, CASE WHEN a.subject_company_id = $1 THEN 'входит в группу' ELSE 'участник группы' END AS direction
     FROM assertions a
     JOIN companies c ON c.id = CASE WHEN a.subject_company_id = $1 THEN a.object_company_id ELSE a.subject_company_id END
     WHERE a.predicate = 'corporate_relation' AND a.role = 'member_of_group' AND a.status <> 'rejected'
       AND (a.subject_company_id = $1 OR a.object_company_id = $1)
       AND EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports')
     LIMIT $2`,
    [companyId, LIST_MAX],
  );
  const domrf = await query<{ kind: string; name: string | null; inn: string | null; group_name: string | null }>(
    `SELECT l.kind, coalesce(d.name, l.name) AS name, d.inn, d.group_name
     FROM domrf_company_links l LEFT JOIN domrf_cards d ON d.kind = l.kind AND d.external_ref = l.external_ref
     WHERE l.company_id = $1 AND l.state = 'confirmed'`,
    [companyId],
  );
  return [
    ...listLine(
      'Объекты в каталоге',
      objects.map(o => `${o.name}${o.city ? ` — ${o.city}` : ''} (${ROLE_WORDS[o.role] ?? o.role})`),
    ),
    ...listLine('Группа компаний', groups.map(g => `${g.direction}: ${g.name}`)),
    ...listLine(
      'Запись ДОМ.РФ',
      domrf.map(d =>
        [d.kind === 'group' ? 'группа компаний' : 'застройщик', d.name ?? '', d.inn ? `ИНН ${d.inn}` : '', d.group_name ? `группа ${d.group_name}` : '']
          .filter(Boolean)
          .join(', '),
      ),
    ),
  ];
};

const projectExtras = async (projectId: number): Promise<{ lines: string[]; registryRef: string | null }> => {
  const project = await queryOne<{ address: string | null; parent: string | null }>(
    `SELECT p.address, parent.name AS parent FROM projects p LEFT JOIN projects parent ON parent.id = p.parent_project_id WHERE p.id = $1`,
    [projectId],
  );
  const registry = await queryOne<{ external_ref: string; address: string | null; developer: string | null; status: string | null }>(
    `SELECT r.external_ref, r.payload->'identity'->>'address' AS address,
            coalesce(r.payload->'identity'->'developer'->>'name',
                     (SELECT f->>'value' FROM jsonb_array_elements(r.payload->'fields') f WHERE f->>'label' = 'Застройщик' LIMIT 1)) AS developer,
            (SELECT f->>'value' FROM jsonb_array_elements(r.payload->'fields') f WHERE f->>'label' = 'Статус строительства' LIMIT 1) AS status
     FROM registry_records r WHERE r.project_id = $1 AND r.record_type = 'object' ORDER BY r.fetched_at DESC LIMIT 1`,
    [projectId],
  );
  const participants = await query<{ name: string; role: string }>(
    `SELECT DISTINCT c.name, pp.role
     FROM card_participations_v pp JOIN companies c ON c.id = pp.company_id AND c.merged_into_id IS NULL
     WHERE pp.project_id = $1 ORDER BY c.name LIMIT $2`,
    [projectId, LIST_MAX],
  );
  return {
    registryRef: registry?.external_ref ?? null,
    lines: [
      `Адрес: ${project?.address ?? registry?.address ?? 'неизвестен'}`,
      ...(project?.parent ? [`Входит в: ${project.parent}`] : []),
      `Запись ДОМ.РФ: ${registry ? [`№ ${registry.external_ref}`, registry.status, registry.developer ? `застройщик ${registry.developer}` : null].filter(Boolean).join(', ') : 'нет'}`,
      ...listLine('Участники', participants.map(p => `${p.name} (${ROLE_WORDS[p.role] ?? p.role})`)),
    ],
  };
};

/** Вес карточки для направления слияния: реквизиты и сведения ДОМ.РФ дороже названия. */
const weight = (s: IEntitySummary, registryRef: string | null): number => s.identifiers.length * 10 + (registryRef ? 5 : 0) + s.aliases.length;

export interface IPairJudgement {
  queueId: number;
  kind: 'company' | 'project';
  sourceId: number;
  targetId: number;
  sourceName: string;
  targetName: string;
  verdict: EntityMatchVerdict;
  reason: string;
  /** rule — решило правило без модели; model — модель. */
  by: 'rule' | 'model';
  /** Что сделано: judged — только вердикт; merged / rejected — применено; blocked — применить нельзя (почему — note). */
  action: 'judged' | 'merged' | 'rejected' | 'blocked';
  note: string | null;
}

export type EntityMatchCaller = (body: string) => Promise<ILlmResult<IEntityMatch>>;

// Две фразы, а не текст: большой лимит токенов только продлевает ожидание.
const defaultCaller: EntityMatchCaller = body => extractEntityMatch({ body, publishedAt: null, maxTokens: 300 });

const saveVerdict = async (queueId: number, verdict: EntityMatchVerdict, reason: string): Promise<void> => {
  await query(
    `UPDATE merge_queue SET model_verdict = $2, model_reason = $3, model_error = NULL, model_name = $4,
       model_prompt_version = $5, judged_at = now()
     WHERE id = $1`,
    [queueId, verdict, reason, env.LMSTUDIO_MODEL, ENTITY_MATCH_PROMPT_VERSION],
  );
};

const saveError = async (queueId: number, error: string): Promise<void> => {
  await query(
    `UPDATE merge_queue SET model_verdict = NULL, model_reason = NULL, model_error = $2, model_name = $3,
       model_prompt_version = $4, judged_at = now()
     WHERE id = $1`,
    [queueId, error.slice(0, 500), env.LMSTUDIO_MODEL, ENTITY_MATCH_PROMPT_VERSION],
  );
};

const rejectPair = async (queueId: number, note: string): Promise<boolean> =>
  (
    await query<{ id: number }>(
      `UPDATE merge_queue SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [queueId, modelActor(), note.slice(0, 500)],
    )
  ).length > 0;

const noteOn = async (queueId: number, note: string): Promise<void> => {
  await query(`UPDATE merge_queue SET decision_note = $2 WHERE id = $1`, [queueId, note.slice(0, 500)]);
};

/** Слияние по вердикту same: к более весомой карточке, с предпросмотром именно этого направления. */
const mergePair = async (
  pair: IPairRow,
  preview: IMergePreview,
  sourceRegistry: string | null,
  targetRegistry: string | null,
  reason: string,
): Promise<{ action: 'merged' | 'blocked'; note: string | null }> => {
  if (!env.MERGE_APPLY_ENABLED) return { action: 'blocked', note: 'слияние выключено на сервере (MERGE_APPLY_ENABLED=false)' };
  const swap = weight(preview.source, sourceRegistry) > weight(preview.target, targetRegistry);
  const plan = swap ? await previewMerge(pair.entity_kind, pair.target_entity_id, pair.source_entity_id) : preview;
  if (!plan.canApply) {
    const codes = [...new Set(plan.conflicts.map(c => c.code))].join(', ');
    const note = `модель считает это одним, но слияние не проходит проверку: ${codes || 'препятствие предпросмотра'}`;
    await noteOn(pair.id, note);
    return { action: 'blocked', note };
  }
  await applyEntityMerge({
    kind: pair.entity_kind,
    sourceId: plan.source.id,
    targetId: plan.target.id,
    expectedSourceVersion: plan.source.version,
    expectedTargetVersion: plan.target.version,
    idempotencyKey: `model-review:${pair.id}:${randomUUID()}`,
    actor: modelActor(),
    reason: `решила модель: ${reason}`.slice(0, 500),
    queueId: pair.id,
    expectedPreviewToken: plan.previewToken,
  });
  return { action: 'merged', note: null };
};

/**
 * Один проход: до `limit` пар. Модель не отвечает — проход останавливается (следующие не ответят тоже).
 * apply=false — только вердикты (прогон «посмотреть, что решит модель»).
 */
export const runModelReviewPass = async (
  options: { limit?: number; apply?: boolean; caller?: EntityMatchCaller } = {},
): Promise<IPairJudgement[]> => {
  const limit = options.limit ?? env.MODEL_REVIEW_BATCH_SIZE;
  const apply = options.apply ?? env.MODEL_REVIEW_APPLY;
  const caller = options.caller ?? defaultCaller;
  const results: IPairJudgement[] = [];

  for (const pair of await pairsToJudge(limit)) {
    let preview: IMergePreview;
    try {
      preview = await previewMerge(pair.entity_kind, pair.source_entity_id, pair.target_entity_id);
    } catch (err) {
      if (err instanceof MergeNotFoundError) continue;
      throw err;
    }
    const base = {
      queueId: pair.id,
      kind: pair.entity_kind,
      sourceId: pair.source_entity_id,
      targetId: pair.target_entity_id,
      sourceName: preview.source.name,
      targetName: preview.target.name,
    };

    let sourceRegistry: string | null = null;
    let targetRegistry: string | null = null;
    let sourceLines = summaryLines(preview.source, pair.entity_kind);
    let targetLines = summaryLines(preview.target, pair.entity_kind);
    if (pair.entity_kind === 'company') {
      sourceLines = [...sourceLines, ...(await companyExtras(pair.source_entity_id))];
      targetLines = [...targetLines, ...(await companyExtras(pair.target_entity_id))];
    } else {
      const s = await projectExtras(pair.source_entity_id);
      const t = await projectExtras(pair.target_entity_id);
      sourceRegistry = s.registryRef;
      targetRegistry = t.registryRef;
      sourceLines = [...sourceLines, ...s.lines];
      targetLines = [...targetLines, ...t.lines];
    }

    // Правила раньше модели: здесь ответ известен без неё.
    let verdict: EntityMatchVerdict;
    let reason: string;
    let by: 'rule' | 'model' = 'rule';
    if (preview.conflicts.some(c => c.code === 'identifier_conflict')) {
      verdict = 'different';
      reason = 'разные ИНН или ОГРН — разные юрлица (правило, без модели)';
    } else if (sourceRegistry && targetRegistry && sourceRegistry !== targetRegistry) {
      verdict = 'different';
      reason = `разные записи ДОМ.РФ (№ ${sourceRegistry} и № ${targetRegistry}) — разные объекты (правило, без модели)`;
    } else {
      by = 'model';
      const body = formatEntityMatchInput(
        pair.entity_kind,
        { label: `№ ${pair.source_entity_id}`, lines: sourceLines },
        { label: `№ ${pair.target_entity_id}`, lines: targetLines },
      );
      let result: ILlmResult<IEntityMatch>;
      try {
        result = await caller(body);
      } catch (err) {
        console.warn(`[model-review] модель не ответила: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
      if (!result.ok && result.failure === 'llm_error') {
        console.warn(`[model-review] модель не ответила: ${result.message}`);
        break;
      }
      if (!result.ok) {
        await saveError(pair.id, `${result.failure}: ${result.message}`);
        continue;
      }
      verdict = result.data.verdict;
      reason = result.data.reason;
    }
    await saveVerdict(pair.id, verdict, reason);

    let action: IPairJudgement['action'] = 'judged';
    let note: string | null = null;
    if (apply && verdict === 'different') {
      if (await rejectPair(pair.id, reason)) action = 'rejected';
    } else if (apply && verdict === 'same') {
      try {
        const merged = await mergePair(pair, preview, sourceRegistry, targetRegistry, reason);
        action = merged.action;
        note = merged.note;
      } catch (err) {
        // Версия или зависимости успели смениться, конфликт уникальности: пара ждёт следующего прохода.
        action = 'blocked';
        note = `слияние не выполнено: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
        await noteOn(pair.id, note);
      }
    }
    results.push({ ...base, verdict, reason, by, action, note });
  }
  return results;
};

/** Сколько пар ждёт решения и сколько уже с вердиктом нынешней модели — для экрана и CLI. */
export const modelReviewCounts = async (): Promise<{ judged: number; waiting: number }> =>
  (await queryOne<{ judged: number; waiting: number }>(
    `SELECT count(*) FILTER (WHERE model_name = $1 AND model_prompt_version = $2)::int AS judged,
            count(*) FILTER (WHERE model_name IS DISTINCT FROM $1 OR model_prompt_version IS DISTINCT FROM $2)::int AS waiting
     FROM merge_queue WHERE status = 'pending'`,
    [env.LMSTUDIO_MODEL, ENTITY_MATCH_PROMPT_VERSION],
  )) ?? { judged: 0, waiting: 0 };
