// Разбор одного текста: заголовок «Разбор от …», итог одной фразой, сам текст, найденное;
// номера, модель и отпечаток — только под «Техническими подробностями». Только чтение.
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../../test/render';
import { RunPage } from './RunPage';

const detail = (over: Record<string, unknown> = {}) => ({
  id: 501,
  revisionId: 9000,
  revisionNo: 2,
  latestRevisionNo: 3,
  sourceItemId: 1000,
  source: { id: 1, key: 'demo' },
  status: 'completed',
  error: null,
  fingerprint: 'a3f9c1e07b5d2a6480e1f9cc27d4b3aa',
  model: 'qwen/qwen3-30b',
  schemaVersion: 'extract@3',
  promptVersion: 'p3',
  previousRunId: null,
  coverage: { coveredChars: 100, totalChars: 100, chunks: 1, chunksOk: 1, chunksFailed: 0 },
  relevant: false,
  requestedBy: 'auto',
  createdAt: '2026-09-30T08:00:00Z',
  startedAt: '2026-09-30T08:00:00Z',
  finishedAt: '2026-09-30T08:00:41Z',
  usage: { responses: 1, tokensIn: 3100, tokensOut: 420, latencyMs: 41000 },
  policy: { allowed: true, reason: null },
  candidateSet: null,
  identity: { historical: false, candidateBuildVersion: 'candidate-build@4', candidateBuildCurrent: true, provider: 'openrouter' },
  lineage: { previous: [], retries: [] },
  inFlight: false,
  lease: { owner: null, expiresAt: null, claimCount: 0 },
  revision: { id: 9000, no: 2, title: null, publishedAt: '2026-09-29T15:42:00Z', bodyChars: 100 },
  latestRevision: { id: 9040, no: 3 },
  publication: { activeSetId: null, activeRunId: null, activeRevisionNo: null, version: 0 },
  chunks: [{ index: 0, rangeStart: 0, rangeEnd: 100, status: 'ok', attempts: 1, lastError: null, responses: [] }],
  candidates: [],
  ambiguities: [],
  runComplete: true,
  ...over,
});

const render = (body: unknown) => {
  fakeApi([
    { match: 'GET /api/reprocess/runs/501', respond: () => ({ status: 200, body }) },
    {
      match: 'GET /api/admin/sources',
      respond: () => ({ status: 200, body: { items: [{ id: 1, kind: 'telegram', key: 'demo', title: 'Демо-канал' }] } }),
    },
    {
      match: 'GET /api/revisions/9000',
      respond: () => ({
        status: 200,
        body: {
          revision: {
            id: 9000,
            revisionNo: 2,
            representation: 'text',
            completeness: 'full',
            completenessReason: null,
            attachments: [],
            publishedAt: '2026-09-29T15:42:00Z',
            sourceModifiedAt: null,
            firstObservedAt: '2026-09-29T15:50:00Z',
            chronology: 'unknown',
            sameContentAsRevisionId: null,
            legacyDocumentId: 31,
            origin: 'ingest',
            sourceItemId: 1000,
            title: null,
            body: 'Губернатор открыл сезон фестивалей.',
          },
        },
      }),
    },
  ]);
  return renderWithProviders(
    <Routes>
      <Route path="/admin/process/:id" element={<RunPage />} />
    </Routes>,
    '/admin/process/501',
  );
};

describe('Разбор текста', () => {
  it('заголовок — дата разбора, итог одной фразой, сам текст; технические подробности — свёрнуты', async () => {
    render(detail());

    const h1 = await screen.findByRole('heading', { level: 1, name: /^Разбор от/ });
    expect(h1.textContent).toMatch(/^Разбор от \d\d\.\d\d\.\d\d, \d\d:\d\d$/);
    expect(screen.getAllByText('не о стройке').length).toBeGreaterThan(0);
    expect(screen.getByText(/Модель не нашла в тексте строительной темы/)).toBeTruthy();
    expect(screen.getByText('Текст изменился после этого разбора; портал разберёт новую версию сам.')).toBeTruthy();
    expect(await screen.findByText('Губернатор открыл сезон фестивалей.')).toBeTruthy();
    expect(screen.getByText('Текст не о стройке — переносить нечего.')).toBeTruthy();

    // Отпечаток и модель — только внутри «Технических подробностей», и они свёрнуты.
    const details = screen.getByText('Технические подробности').closest('details')!;
    expect(details.open).toBe(false);
    expect(within(details).getByText('a3f9c1e07b5d2a6480e1f9cc27d4b3aa')).toBeTruthy();
    expect(h1.textContent).not.toMatch(/#501|a3f9/);
    // Хлебных крошек «Запуски / #N» и кнопок постановки или повтора нет: обработка идёт сама.
    expect(screen.queryByText(/Запуски \//)).toBeNull();
    expect(screen.queryByRole('button', { name: /Повторить разбор|Поставить|Отменить/ })).toBeNull();
  });

  it('неудачный разбор: причина словами, отдельно от итога', async () => {
    render(detail({ status: 'failed', relevant: null, error: 'модель не ответила за 120 с', finishedAt: null }));
    expect(await screen.findByText('Что пошло не так')).toBeTruthy();
    expect(screen.getByText('модель не ответила за 120 с')).toBeTruthy();
    expect(screen.getByText(/Разбор не удался\. Если повтор включён, портал повторит его сам/)).toBeTruthy();
  });

  it('несуществующий разбор — «не найден», а не «загрузка» навсегда', async () => {
    fakeApi([{ match: 'GET /api/reprocess/runs/501', respond: () => ({ status: 404, body: { error: 'Запуск #501 не найден' } }) }]);
    renderWithProviders(
      <Routes>
        <Route path="/admin/process/:id" element={<RunPage />} />
      </Routes>,
      '/admin/process/501',
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Разбор не найден' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'К разборам' }).getAttribute('href')).toBe('/admin/process');
  });
});
