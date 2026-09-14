// Блокировка изменения legacy-канона: операции отказывают ДО обращения к БД.
// В unit-профиле DATABASE_URL мёртвый — если бы запрос ушёл, была бы ошибка
// соединения, а не CanonWriteBlockedError.

import { describe, it, expect } from 'vitest';

import { applyMerge } from '../resolve/merge.js';
import { CanonWriteBlockedError } from './guard.js';
import { requeueForReextraction, renormalizeEntities } from './quality.js';
import { recheckProjectFields } from './recheck.js';
import { retryFailed, retrySkipped } from './cli-commands.js';
import { runPipelinePass } from './worker.js';

describe('изменяющие канон пути заблокированы', () => {
  it('проход конвейера', async () => {
    await expect(runPipelinePass()).rejects.toBeInstanceOf(CanonWriteBlockedError);
  });

  it('массовый переразбор', async () => {
    await expect(requeueForReextraction(null)).rejects.toBeInstanceOf(CanonWriteBlockedError);
    await expect(requeueForReextraction('one-source')).rejects.toBeInstanceOf(CanonWriteBlockedError);
  });

  it('возврат в очередь', async () => {
    await expect(retryFailed()).rejects.toBeInstanceOf(CanonWriteBlockedError);
    await expect(retrySkipped(true)).rejects.toBeInstanceOf(CanonWriteBlockedError);
  });

  it('ренормализация и recheck с записью', async () => {
    await expect(renormalizeEntities(false)).rejects.toBeInstanceOf(CanonWriteBlockedError);
    await expect(recheckProjectFields(false)).rejects.toBeInstanceOf(CanonWriteBlockedError);
  });

  it('слияние', async () => {
    await expect(applyMerge({ queueId: 1, decidedBy: 'test' })).rejects.toThrow(/этапа 04/);
  });
});
