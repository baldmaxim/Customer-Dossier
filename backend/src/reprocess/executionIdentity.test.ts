// Этап 11 (T11-01, T11-04, T11-06, T11-07): идентичность исполнения запуска и остановка повторов без базы.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractSemantic } from '../llm/client.js';
import { NO_THINK } from '../llm/prompt.js';
import { answer } from './semantic/__fixtures__/semanticAnswers.js';
import {
  CANDIDATE_BUILD_VERSION,
  EXECUTION_IDENTITY_VERSION,
  buildFingerprint,
  buildModelIdentity,
  isHistoricalIdentity,
  lmStudioProvider,
  type IChunkerParams,
  type IModelProvider,
} from './provider.js';
import { PolicyRevokedError, executionMismatch, type IRunClaim } from './runs.js';

const chunker: IChunkerParams = { chunkSize: 3500, maxChunks: 6, overlap: 400 };
const providerA = (over: Partial<IModelProvider> = {}): IModelProvider => ({
  provider: 'fake',
  model: 'model-a',
  params: { temperature: 0 },
  schemaVersion: 'extract@3',
  extract: async () => ({ ok: true, data: answer({}), usage: { tokensIn: 1, tokensOut: 1, latencyMs: 1 }, rawResponse: '{}' }),
  ...over,
});
const claimFor = (provider: IModelProvider): IRunClaim => ({ runId: 1, revisionId: 1, fencingToken: 1, owner: 'w', chunker, fingerprint: buildFingerprint(provider, chunker).fingerprint });

describe('execution-identity@1', () => {
  it('одинаковая конфигурация — одинаковый отпечаток (A/A проходит)', () => {
    expect(buildFingerprint(providerA(), chunker)).toEqual(buildFingerprint(providerA(), chunker));
    expect(executionMismatch(providerA(), claimFor(providerA()))).toBeNull();
  });

  it('другая модель, параметры, схема или нарезка — другой отпечаток', () => {
    const base = buildFingerprint(providerA(), chunker).fingerprint;
    expect(buildFingerprint(providerA({ model: 'model-b' }), chunker).fingerprint).not.toBe(base);
    expect(buildFingerprint(providerA({ params: { temperature: 0.3 } }), chunker).fingerprint).not.toBe(base);
    expect(buildFingerprint(providerA({ schemaVersion: undefined }), chunker).fingerprint).not.toBe(base);
    expect(buildFingerprint(providerA(), { ...chunker, overlap: 50 }).fingerprint).not.toBe(base);
  });

  it('T11-01: запуск модели A у исполнителя B — явное несовпадение до вызова', () => {
    const mismatch = executionMismatch(providerA({ model: 'model-b' }), claimFor(providerA()));
    expect(mismatch).toMatch(/^config_mismatch:/);
    expect(mismatch).toContain('fake/model-b');
  });

  it('идентичность модели не зависит от нарезки: worker отбирает очередь по модели, нарезку берёт из запуска', () => {
    expect(buildFingerprint(providerA(), chunker).modelIdentityHash).toBe(buildFingerprint(providerA(), { chunkSize: 1, maxChunks: 1, overlap: 0 }).modelIdentityHash);
  });

  it('T11-06: в идентичность входят эффективное системное сообщение с /no_think, шаблон, схема, политика повторов и версия проверки', () => {
    const id = buildModelIdentity(providerA());
    expect(id.identityVersion).toBe(EXECUTION_IDENTITY_VERSION);
    expect(id).toEqual(
      expect.objectContaining({
        systemMessageHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        userTemplateHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        schemaVersion: 'extract@3',
        retryPolicy: expect.stringMatching(/^retry@1/),
        candidateBuildVersion: CANDIDATE_BUILD_VERSION,
      }),
    );
    // /no_think — часть эффективного сообщения: его хеш отличается от хеша голого промпта.
    expect(id.systemMessageHash).not.toBe(id.promptHash);
    expect(NO_THINK).toBe('/no_think');
    expect(JSON.stringify(id)).not.toMatch(/127\.0\.0\.1|http:\/\//);
  });

  it('T11-07: несообщённые сервером сведения — unknown, а не догадка', () => {
    expect(buildModelIdentity(providerA()).serverReported).toEqual({ quantization: 'unknown', contextWindow: 'unknown', runtimeVersion: 'unknown' });
    expect(buildModelIdentity(lmStudioProvider()).serverReported).toEqual({ quantization: 'unknown', contextWindow: 'unknown', runtimeVersion: 'unknown' });
    expect(buildModelIdentity(providerA({ serverReported: { quantization: 'Q4_K_M' } })).serverReported).toMatchObject({ quantization: 'Q4_K_M', contextWindow: 'unknown' });
  });

  it('запуск до этапа 11 — historical: идентичность неполная, не реконструируется', () => {
    expect(isHistoricalIdentity({ promptVersion: 'p1', model: 'qwen3-8b' })).toBe(true);
    expect(isHistoricalIdentity(buildFingerprint(providerA(), chunker).json)).toBe(false);
  });
});

describe('повторы внутри клиента модели', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('T11-04: перед повтором допуск отозван — повторный запрос не отправляется', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      calls.push(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"не json' } }] }), { status: 200 });
    });
    let attempts = 0;
    const beforeAttempt = async () => {
      attempts += 1;
      if (attempts > 1) throw new PolicyRevokedError(7, 'ИИ-обработка отозвана');
    };
    await expect(extractSemantic({ body: 'Текст новости о стройке.', publishedAt: null, beforeAttempt })).rejects.toBeInstanceOf(PolicyRevokedError);
    expect(calls).toHaveLength(1);
  });

  it('внешняя отмена прерывает ожидание ответа (best-effort) и не отменяет таймаут', async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => {
      seen = init.signal;
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    const controller = new AbortController();
    let n = 0;
    const pending = extractSemantic({
      body: 'Текст.',
      publishedAt: null,
      signal: controller.signal,
      beforeAttempt: async () => {
        n += 1;
        if (n > 1) throw new PolicyRevokedError(1, 'отозван');
      },
    });
    await new Promise(r => setTimeout(r, 10));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(PolicyRevokedError);
    expect(seen?.aborted).toBe(true);
  }, 10_000);
});
