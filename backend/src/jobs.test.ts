// TC-001: запуск API не запускает сбор, бот, разбор моделью и метрики.

import { describe, it, expect, vi } from 'vitest';

import { startBackgroundJobs, type IJobFlags, type IJobStarters } from './jobs.js';

const starters = (): IJobStarters & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    ingest: vi.fn(() => void calls.push('ingest')),
    pipeline: vi.fn(() => void calls.push('pipeline')),
    metrics: vi.fn(() => void calls.push('metrics')),
    bot: vi.fn(() => void calls.push('bot')),
  };
};

const flags = (over: Partial<IJobFlags> = {}): IJobFlags => ({
  INGEST_ENABLED: false,
  PIPELINE_ENABLED: false,
  REPROCESS_AUTO_PUBLISH: false,
  HEADLINE_ENABLED: false,
  METRICS_AUTO_REFRESH: false,
  BOT_ENABLED: false,
  TG_BOT_TOKEN: '',
  ...over,
});

describe('startBackgroundJobs', () => {
  it('по умолчанию не запускает ничего (TC-001)', () => {
    const s = starters();
    const decision = startBackgroundJobs(flags(), s, new AbortController().signal);
    expect(s.calls).toEqual([]);
    expect(decision.started).toEqual([]);
  });

  it('заданный токен бота сам по себе бот не включает', () => {
    const s = starters();
    startBackgroundJobs(flags({ TG_BOT_TOKEN: 'token-present' }), s, new AbortController().signal);
    expect(s.calls).toEqual([]);
  });

  it('BOT_ENABLED без токена бот не запускает', () => {
    const s = starters();
    const decision = startBackgroundJobs(flags({ BOT_ENABLED: true }), s, new AbortController().signal);
    expect(s.calls).toEqual([]);
    expect(decision.notes.join(' ')).toContain('TG_BOT_TOKEN пуст');
  });

  it('PIPELINE_ENABLED запускает новый конвейер; автопубликация по умолчанию выключена', () => {
    const s = starters();
    const decision = startBackgroundJobs(flags({ PIPELINE_ENABLED: true }), s, new AbortController().signal);
    expect(s.calls).toEqual(['pipeline']);
    expect(decision.notes.join(' ')).toContain('REPROCESS_AUTO_PUBLISH=false');
  });

  it('тема публикации идёт с разбором: без PIPELINE_ENABLED её никто не составляет', () => {
    const s = starters();
    const off = startBackgroundJobs(flags({ HEADLINE_ENABLED: true }), s, new AbortController().signal);
    expect(s.calls).toEqual([]);
    expect(off.notes.join(' ')).toContain('темы публикаций тоже не составляются');

    const on = startBackgroundJobs(
      flags({ PIPELINE_ENABLED: true, HEADLINE_ENABLED: true }),
      starters(),
      new AbortController().signal,
    );
    expect(on.notes.join(' ')).toContain('HEADLINE_ENABLED=true');
  });

  it('явные флаги включают ровно свои задания', () => {
    const s = starters();
    const decision = startBackgroundJobs(
      flags({ INGEST_ENABLED: true, METRICS_AUTO_REFRESH: true, BOT_ENABLED: true, TG_BOT_TOKEN: 't' }),
      s,
      new AbortController().signal,
    );
    expect(s.calls).toEqual(['ingest', 'metrics', 'bot']);
    expect(decision.started).toEqual(['ingest', 'metrics', 'bot']);
  });
});
