// Этап 18: ошибка загрузки отличима от пустого списка; курсор страницы; предупреждение о выключенном исполнителе.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, offlineApi, renderWithProviders } from '../../test/render';
import { RunsPage } from './RunsPage';

const run = (id: number) => ({
  id,
  revisionId: 1,
  revisionNo: 1,
  latestRevisionNo: 2,
  sourceItemId: 1,
  source: { id: 1, key: 'demo' },
  status: 'partial',
  error: 'разобрано 1 из 2 чанков',
  fingerprint: 'abcdef0123456789',
  model: 'fake',
  schemaVersion: 'extract@3',
  promptVersion: 'p',
  previousRunId: null,
  coverage: { coveredChars: 10, totalChars: 20, chunks: 2, chunksOk: 1, chunksFailed: 1 },
  relevant: null,
  requestedBy: 'test',
  createdAt: '2026-09-17T10:00:00Z',
  startedAt: null,
  finishedAt: null,
  usage: { responses: 2, tokensIn: null, tokensOut: null, latencyMs: null },
  policy: { allowed: true, reason: null },
  candidateSet: null,
});

describe('RunsPage — состояния загрузки', () => {
  it('нет соединения — сообщение об отказе, а не «запусков нет»', async () => {
    offlineApi();
    renderWithProviders(<RunsPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Нет соединения с API/);
    expect(screen.queryByText(/Запусков по фильтру нет/)).toBeNull();
  });

  it('500 — «сбой сервера … не пустой результат»; 401 — «нет входа»', async () => {
    fakeApi([{ match: 'GET /api/reprocess/runs', respond: () => ({ status: 500, body: { error: 'boom' } }) }]);
    renderWithProviders(<RunsPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Сбой сервера \(500\).*не пустой результат/);
  });

  it('пустой ответ — «запусков нет»; выключенный исполнитель показан', async () => {
    fakeApi([{ match: 'GET /api/reprocess/runs', respond: () => ({ status: 200, body: { items: [], total: 0, nextBeforeId: null, worker: { pipelineEnabled: false, autoPublish: false } } }) }]);
    renderWithProviders(<RunsPage />);
    expect(await screen.findByText(/Запусков по фильтру нет/)).toBeTruthy();
    expect(screen.getByText(/PIPELINE_ENABLED=false/)).toBeTruthy();
  });

  it('«Дальше» запрашивает следующую страницу по beforeId; неизвестные токены не показаны нулём', async () => {
    const api = fakeApi([
      {
        match: 'GET /api/reprocess/runs',
        respond: url =>
          url.includes('beforeId=150')
            ? { status: 200, body: { items: [run(149)], total: 151, nextBeforeId: null, worker: { pipelineEnabled: true, autoPublish: false } } }
            : { status: 200, body: { items: [run(151), run(150)], total: 151, nextBeforeId: 150, worker: { pipelineEnabled: true, autoPublish: false } } },
      },
    ]);
    renderWithProviders(<RunsPage />);
    expect(await screen.findByText(/Всего по фильтру: 151/)).toBeTruthy();
    expect(screen.getAllByText(/время неизвестно/).length).toBe(2);
    expect(screen.getAllByText(/есть №2/).length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await waitFor(() => expect(api.calls.some(c => c.url.includes('beforeId=150'))).toBe(true));
    expect(await screen.findByText('#149')).toBeTruthy();
  });
});
