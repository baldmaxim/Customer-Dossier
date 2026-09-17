// Манифест ограниченного пилота и проверка перед стартом (этап 19, pilot-manifest@1, pilot-gate@1).
//
// Манифест — решение владельца, а не разрешение по умолчанию: без утверждённого манифеста, названных источников с
// действующим допуском, подтверждённой цели и выключенных фоновых задач пилот не стартует. Проверка только читает:
// допуск источников, применённые миграции и имя базы; ничего не включает и не пишет.
// Запреты пилота — литералы схемы: автопубликация, применение слияний, миграция рабочей базы, публичный доступ и внешняя
// передача не могут быть разрешены этим файлом.

import { z } from 'zod';

import { evaluateSourcePolicy, type PermissionStatus } from '../ingest/policy.js';

export const PILOT_MANIFEST_CONTRACT = 'pilot-manifest@1';
export const PILOT_GATE_VERSION = 'pilot-gate@1';
export const PILOT_MAX_ITEMS_TOTAL = 1000;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().min(1).max(max);

export const pilotManifestSchema = z
  .object({
    contract: z.literal(PILOT_MANIFEST_CONTRACT),
    status: z.enum(['draft', 'approved']),
    owner: text(120),
    decidedAt: date.nullable(),
    target: z
      .object({
        /** Имя базы, к которой подключится пилот: сверяется с current_database(). */
        database: text(63),
        kind: z.enum(['test', 'working']),
        /** Как оператор убедился, что это именно эта база (не секрет, не адрес с паролем). */
        identifiedBy: text(500),
      })
      .strict(),
    window: z
      .object({
        from: date,
        to: date,
        maxItemsPerSource: z.number().int().min(1).max(200),
        maxItemsTotal: z.number().int().min(1).max(PILOT_MAX_ITEMS_TOTAL),
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            key: text(200),
            kind: z.enum(['website', 'telegram']),
            collectEvidence: text(500),
            /** null — только сбор, без ИИ-обработки. */
            aiEvidence: text(500).nullable(),
          })
          .strict(),
      )
      .max(10),
    subjects: z.object({ companies: z.array(text(300)).max(50), projects: z.array(text(300)).max(50) }).strict(),
    model: z
      .object({
        executionFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
        /** Решение QUALITY_DECISION по этой конфигурации. */
        qualityDecision: z.enum(['selected', 'pending', 'rejected']),
      })
      .strict(),
    review: z.object({ mandatory: z.literal(true), reviewers: z.array(text(120)).min(1).max(10) }).strict(),
    forbidden: z
      .object({
        autopublish: z.literal(true),
        mergeApply: z.literal(true),
        workingDatabaseMigration: z.literal(true),
        publicAccess: z.literal(true),
        externalTransfer: z.literal(true),
      })
      .strict(),
    retention: z
      .object({
        /** Сырые попытки и диагностика — отдельно от редакций, доказательств, решений и снимков (их автоудаление не включается). */
        rawAttemptsDays: z.number().int().min(1).max(3650).nullable(),
        resultsAccess: z.array(text(120)).min(1).max(10),
      })
      .strict(),
  })
  .strict();

export type IPilotManifest = z.infer<typeof pilotManifestSchema>;

export interface IPilotEnvFlags {
  INGEST_ENABLED: boolean;
  PIPELINE_ENABLED: boolean;
  BOT_ENABLED: boolean;
  METRICS_AUTO_REFRESH: boolean;
  REPROCESS_AUTO_PUBLISH: boolean;
  MERGE_APPLY_ENABLED: boolean;
  HOST: string;
}

export interface IPilotSourceRow {
  key: string;
  kind: string;
  accessStatus: PermissionStatus;
  aiProcessingStatus: PermissionStatus;
  policyExpiresAt: Date | null;
}

export interface IPilotGateInput {
  manifest: unknown;
  env: IPilotEnvFlags;
  connectedDatabase: string;
  sources: IPilotSourceRow[];
  pendingMigrations: string[];
  now?: Date;
}

export interface IPilotGateResult {
  version: typeof PILOT_GATE_VERSION;
  verdict: 'READY_TO_START' | 'BLOCKED';
  blockers: string[];
  warnings: string[];
  /** Какие шаги разрешены по манифесту и допускам: сбор — по источникам, ИИ — только где есть и основание, и допуск. */
  allowedSteps: { collect: string[]; ai: string[] };
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export const pilotGate = (input: IPilotGateInput): IPilotGateResult => {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const allowed = { collect: [] as string[], ai: [] as string[] };
  const done = (): IPilotGateResult => ({ version: PILOT_GATE_VERSION, verdict: blockers.length === 0 ? 'READY_TO_START' : 'BLOCKED', blockers, warnings, allowedSteps: allowed });

  const parsed = pilotManifestSchema.safeParse(input.manifest);
  if (!parsed.success) {
    blockers.push(`манифест некорректен: ${parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.') || '—'}: ${i.message}`).join('; ')}`);
    return done();
  }
  const m = parsed.data;
  if (m.status !== 'approved' || m.decidedAt === null) blockers.push('манифест не утверждён владельцем (status approved и decidedAt)');
  if (m.window.to < m.window.from) blockers.push('окно пилота: конец раньше начала');
  if (m.sources.length === 0) blockers.push('источники не названы — пилот не стартует и источники не подбираются автоматически');
  if (m.window.maxItemsPerSource * m.sources.length < 1) blockers.push('лимит материалов не задан');

  // Цель
  if (m.target.database !== input.connectedDatabase) blockers.push(`подключение к «${input.connectedDatabase}», а манифест называет «${m.target.database}»`);
  if (input.pendingMigrations.length > 0) {
    blockers.push(
      m.target.kind === 'working'
        ? `в рабочей базе есть неприменённые миграции (${input.pendingMigrations.length}) — миграция рабочей базы требует отдельного разрешения, пилот им не является`
        : `в базе есть неприменённые миграции (${input.pendingMigrations.length}) — сначала migrate в тестовой цели`,
    );
  }

  // Фон и запреты
  for (const flag of ['INGEST_ENABLED', 'PIPELINE_ENABLED', 'BOT_ENABLED', 'METRICS_AUTO_REFRESH'] as const) {
    if (input.env[flag]) blockers.push(`${flag}=true: фоновые задачи в пилоте выключены, шаги запускаются вручную`);
  }
  if (input.env.REPROCESS_AUTO_PUBLISH) blockers.push('REPROCESS_AUTO_PUBLISH=true: в пилоте каждая публикация — после ручной проверки');
  if (input.env.MERGE_APPLY_ENABLED) blockers.push('MERGE_APPLY_ENABLED=true: применение слияний в пилоте запрещено');
  if (!LOOPBACK.has(input.env.HOST)) blockers.push(`HOST=${input.env.HOST}: портал в пилоте слушает только loopback`);

  // Источники
  const now = input.now ?? new Date();
  for (const s of m.sources) {
    const row = input.sources.find(r => r.key === s.key && r.kind === s.kind);
    if (!row) {
      blockers.push(`источник ${s.kind}:${s.key} не зарегистрирован в целевой базе`);
      continue;
    }
    const fields = { key: row.key, accessStatus: row.accessStatus, aiProcessingStatus: row.aiProcessingStatus, policyExpiresAt: row.policyExpiresAt };
    const collect = evaluateSourcePolicy(fields, 'collect', now);
    if (!collect.allowed) blockers.push(`источник ${s.key}: сбор не допущен (${collect.reason ?? 'допуск не подтверждён'}) — основание в манифесте допуск не выдаёт`);
    else allowed.collect.push(s.key);
    if (s.aiEvidence !== null) {
      const ai = evaluateSourcePolicy(fields, 'ai_processing', now);
      if (!ai.allowed) blockers.push(`источник ${s.key}: ИИ-обработка заявлена, но допуск не действует (${ai.reason ?? 'не подтверждён'})`);
      else if (collect.allowed) allowed.ai.push(s.key);
    } else if (evaluateSourcePolicy(fields, 'ai_processing', now).allowed) {
      warnings.push(`источник ${s.key}: ИИ-допуск в базе есть, но манифест не включает ИИ-обработку — в пилоте не используется`);
    }
  }

  // Модель
  if (allowed.ai.length > 0) {
    if (m.model.qualityDecision === 'rejected') blockers.push('конфигурация модели отклонена по оценке качества — ИИ-шаги пилота не выполняются');
    else if (m.model.qualityDecision !== 'selected') {
      warnings.push('конфигурация модели не выбрана по оценке (LOCAL_MODEL_VALIDATED = нет): кандидаты только через ручную проверку, пропуски вероятны');
    }
    if (m.model.executionFingerprint === null) warnings.push('отпечаток исполнения модели не указан — результаты пилота не привязаны к конфигурации');
  }
  if (m.target.kind === 'working') warnings.push('пилот на рабочей базе: перед стартом — резервная копия и восстановление в отдельную цель (evidence/19/USER_RUN.md шаг B)');
  if (m.retention.rawAttemptsDays === null) warnings.push('срок хранения сырых попыток не задан — автоматическая очистка не выполняется, решение за владельцем');
  return done();
};
