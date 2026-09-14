// TC-008 (чистая логика): unknown/revoked/expired блокируют операцию.
// Проверка на всех входах через БД — policy.int.test.ts.

import { describe, it, expect } from 'vitest';

import {
  SourcePolicyError,
  approvedPolicySql,
  assertSourceAllowed,
  evaluateSourcePolicy,
  type ISourcePolicyFields,
} from './policy.js';

const NOW = new Date('2026-09-14T12:00:00Z');

const source = (over: Partial<ISourcePolicyFields> = {}): ISourcePolicyFields => ({
  key: 'synthetic-channel',
  accessStatus: 'unknown',
  aiProcessingStatus: 'unknown',
  policyExpiresAt: null,
  ...over,
});

describe('evaluateSourcePolicy', () => {
  it.each(['unknown', 'blocked', 'revoked', 'expired'] as const)('статус %s запрещает сбор', status => {
    const decision = evaluateSourcePolicy(source({ accessStatus: status }), 'collect', NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('synthetic-channel');
  });

  it('approved разрешает', () => {
    expect(evaluateSourcePolicy(source({ accessStatus: 'approved' }), 'collect', NOW)).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it('сбор и ИИ-обработка — независимые разрешения', () => {
    const onlyCollect = source({ accessStatus: 'approved', aiProcessingStatus: 'unknown' });
    expect(evaluateSourcePolicy(onlyCollect, 'collect', NOW).allowed).toBe(true);
    expect(evaluateSourcePolicy(onlyCollect, 'ai_processing', NOW).allowed).toBe(false);

    const onlyAi = source({ accessStatus: 'revoked', aiProcessingStatus: 'approved' });
    expect(evaluateSourcePolicy(onlyAi, 'collect', NOW).allowed).toBe(false);
    expect(evaluateSourcePolicy(onlyAi, 'ai_processing', NOW).allowed).toBe(true);
  });

  it('истёкший срок запрещает даже при approved', () => {
    const expired = source({
      accessStatus: 'approved',
      aiProcessingStatus: 'approved',
      policyExpiresAt: new Date('2026-09-14T11:59:59Z'),
    });
    expect(evaluateSourcePolicy(expired, 'collect', NOW).allowed).toBe(false);
    expect(evaluateSourcePolicy(expired, 'ai_processing', NOW).reason).toContain('срок');
  });

  it('срок в будущем не мешает', () => {
    const valid = source({ accessStatus: 'approved', policyExpiresAt: '2027-01-01T00:00:00Z' });
    expect(evaluateSourcePolicy(valid, 'collect', NOW).allowed).toBe(true);
  });

  it('assertSourceAllowed бросает типизированную ошибку', () => {
    expect(() => assertSourceAllowed(source(), 'collect', NOW)).toThrow(SourcePolicyError);
  });
});

describe('approvedPolicySql', () => {
  it('проверяет нужную колонку и срок', () => {
    expect(approvedPolicySql('s', 'collect')).toContain("s.access_status = 'approved'");
    expect(approvedPolicySql('s', 'ai_processing')).toContain("s.ai_processing_status = 'approved'");
    expect(approvedPolicySql('s', 'collect')).toContain('policy_expires_at');
  });
});
