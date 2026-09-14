// Допуск источника к сбору и к ИИ-обработке.
//
// Доступность страницы не означает права её собирать, а право собирать —
// права отдавать тексты модели: это два разных решения с разными основаниями.
// Неподтверждённое основание = операция выключена. Старый operational-статус
// `active` означает только «опрашивать по расписанию», а не «разрешено».
//
// Один и тот же gate на всех входах: шедулер, CLI, форвард-бот, ручная
// вставка, разбор моделью и повторная обработка.

export const PERMISSION_STATUSES = ['unknown', 'approved', 'blocked', 'revoked', 'expired'] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];

export type PolicyOperation = 'collect' | 'ai_processing';

export interface ISourcePolicyFields {
  key: string;
  accessStatus: PermissionStatus;
  aiProcessingStatus: PermissionStatus;
  policyExpiresAt: Date | string | null;
}

export interface IPolicyDecision {
  allowed: boolean;
  /** Человекочитаемая причина отказа — для лога, CLI и админки. */
  reason: string | null;
}

/** Винительный падеж: «нет разрешения на сбор / на ИИ-обработку». */
const OPERATION_LABEL: Record<PolicyOperation, string> = {
  collect: 'сбор',
  ai_processing: 'ИИ-обработку',
};

const STATUS_REASON: Record<Exclude<PermissionStatus, 'approved'>, string> = {
  unknown: 'основание не подтверждено',
  blocked: 'запрещено решением оператора',
  revoked: 'разрешение отозвано',
  expired: 'срок разрешения истёк',
};

export const evaluateSourcePolicy = (
  source: ISourcePolicyFields,
  operation: PolicyOperation,
  now: Date = new Date(),
): IPolicyDecision => {
  const status = operation === 'collect' ? source.accessStatus : source.aiProcessingStatus;
  const label = OPERATION_LABEL[operation];

  if (status !== 'approved') {
    return { allowed: false, reason: `Источник «${source.key}»: нет разрешения на ${label} — ${STATUS_REASON[status]}` };
  }

  if (source.policyExpiresAt !== null) {
    const expiresAt = new Date(source.policyExpiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      return {
        allowed: false,
        reason: `Источник «${source.key}»: нет разрешения на ${label} — ${STATUS_REASON.expired}`,
      };
    }
  }

  return { allowed: true, reason: null };
};

export class SourcePolicyError extends Error {
  constructor(
    readonly sourceKey: string,
    readonly operation: PolicyOperation,
    reason: string,
  ) {
    super(reason);
    this.name = 'SourcePolicyError';
  }
}

export const assertSourceAllowed = (
  source: ISourcePolicyFields,
  operation: PolicyOperation,
  now: Date = new Date(),
): void => {
  const decision = evaluateSourcePolicy(source, operation, now);
  if (!decision.allowed) {
    throw new SourcePolicyError(source.key, operation, decision.reason ?? 'операция запрещена');
  }
};

/**
 * SQL-условие того же смысла для выборок пачками (очередь разбора, теневой
 * прогон). Имя колонки подставляется из фиксированного набора, не из ввода.
 */
export const approvedPolicySql = (alias: string, operation: PolicyOperation): string => {
  const column = operation === 'collect' ? 'access_status' : 'ai_processing_status';
  return `(${alias}.${column} = 'approved' AND (${alias}.policy_expires_at IS NULL OR ${alias}.policy_expires_at > now()))`;
};
