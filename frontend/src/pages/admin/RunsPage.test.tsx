// «Обработка»: ошибка загрузки отличима от пустого списка; итог разбора одним словом; фильтр по
// источнику (по названию, в запрос — номер) и статусу — в адресе; счётчики состояний — фильтры `?state=`;
// «Новее / Старее» по курсору.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IFakeRoute } from '../../test/render';
import { fakeApi, offlineApi, renderWithProviders } from '../../test/render';
import { RunsPage } from './RunsPage';

const run = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  revisionId: 1,
  revisionNo: 1,
  latestRevisionNo: 2,
  sourceItemId: 1,
  source: { id: 1, key: 'demo' },
  status: 'partial',
  error: 'разобрано 1 из 2 частей',
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
  ...over,
});

const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: { items, total: items.length, nextBeforeId: null, worker: { pipelineEnabled: true, autoPublish: true }, ...extra },
});

const SOURCES = [
  { id: 1, kind: 'telegram', key: 'demo', title: 'Демо-канал', collectBlockedReason: null, aiBlockedReason: null, status: 'active' },
  { id: 2, kind: 'website', key: 'erzrf.ru', title: 'ЕРЗ.РФ', collectBlockedReason: null, aiBlockedReason: null, status: 'active' },
];

const PIPELINE = {
  revisions: [
    { state: 'published', n: 81230 },
    { state: 'in_queue', n: 412 },
    { state: 'failed_exhausted', n: 4 },
    { state: 'failed_retrying', n: 10 },
  ],
  failures: [],
  model: { ok: true, error: null, models: [] },
  worker: { ingestEnabled: true, pipelineEnabled: true, autoPublish: true, metricsAutoRefresh: false, retryEnabled: true, retryMax: 3 },
};

const around = (runs: IFakeRoute): IFakeRoute[] => [
  runs,
  { match: 'GET /api/admin/sources', respond: () => ({ status: 200, body: { items: SOURCES } }) },
  { match: 'GET /api/admin/pipeline', respond: () => ({ status: 200, body: PIPELINE }) },
  {
    match: 'GET /api/admin/summary',
    respond: () => ({
      status: 200,
      body: { totals: { companies: 12334, groups: 12, unidentified: 340, projects: 4071, documents: 98213, pendingMerges: 3 } },
    }),
  },
];

const runsCalls = (api: { calls: Array<{ url: string }> }): string[] =>
  api.calls.filter(c => c.url.startsWith('/api/reprocess/runs')).map(c => c.url);

describe('«Обработка»: состояния загрузки', () => {
  it('нет соединения — сообщение об отказе, а не «разборов нет»', async () => {
    offlineApi();
    renderWithProviders(<RunsPage />, '/admin/process');
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some(a => /Нет соединения с API/.test(a.textContent ?? ''))).toBe(true);
    expect(screen.queryByText(/Разборов по фильтру нет/)).toBeNull();
  });

  it('500 — «сбой сервера … не пустой результат»', async () => {
    fakeApi(around({ match: 'GET /api/reprocess/runs', respond: () => ({ status: 500, body: { error: 'boom' } }) }));
    renderWithProviders(<RunsPage />, '/admin/process');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Сбой сервера \(500\).*не пустой результат/);
  });

  it('пустой ответ — «разборов по фильтру нет»; итоги по базе — словами', async () => {
    fakeApi(around({ match: 'GET /api/reprocess/runs', respond: () => page([]) }));
    renderWithProviders(<RunsPage />, '/admin/process');
    expect(await screen.findByText(/Разборов по фильтру нет/)).toBeTruthy();
    // Число и слово — через неразрывный пробел: «98 213» и «текстов» не разъезжаются по строкам.
    // Компании — числами вкладок каталога (юрлица, группы, имена без ИНН), тексты — публикации источников.
    expect((await screen.findByText(/В базе:/)).parentElement?.textContent).toMatch(
      /12\s334\sкомпании, 12\sгрупп, 340\sимён без ИНН, 4\s071\sобъект, 98\s213\sтекстов/,
    );
  });
});

describe('«Обработка»: список разборов', () => {
  it('итог — словом из итога сервера (decideRunOutcome): те же слова, что у плиток, «попытки исчерпаны» — как плитка', async () => {
    fakeApi(
      around({
        match: 'GET /api/reprocess/runs',
        respond: () =>
          page([
            run(10, { status: 'completed', outcome: { state: 'in_cards', detail: null } }),
            run(11, { status: 'completed', outcome: { state: 'not_relevant', detail: null } }),
            run(12, { status: 'completed', outcome: { state: 'built_not_in_cards', detail: 'rejected_stale' } }),
            run(13, { status: 'queued', outcome: { state: 'queued', detail: null } }),
            run(14, { status: 'failed', outcome: { state: 'failed', detail: 'exhausted' } }),
            run(15, { status: 'queued', outcome: { state: 'no_policy', detail: null } }),
          ]),
      }),
    );
    renderWithProviders(<RunsPage />, '/admin/process');
    const table = within(await screen.findByRole('table'));
    for (const word of [
      'в карточках',
      'не о стройке',
      'не перенесён: текст изменился',
      'в очереди на разбор',
      'разбор не удался, попытки исчерпаны',
      'источник выключен',
    ]) {
      expect(table.getByText(word)).toBeTruthy();
    }
    // Источник — названием, а не ключом; строка — ссылка на разбор.
    expect(table.getAllByText('Демо-канал').length).toBe(6);
    expect(table.getAllByRole('link')[0]?.getAttribute('href')).toBe('/admin/process/10');
  });

  it('«Старее» запрашивает следующую страницу по beforeId; неизвестная длительность — прочерк, а не ноль', async () => {
    const api = fakeApi(
      around({
        match: 'GET /api/reprocess/runs',
        respond: url =>
          url.includes('beforeId=150') ? page([run(149)], { total: 151 }) : page([run(151), run(150)], { total: 151, nextBeforeId: 150 }),
      }),
    );
    renderWithProviders(<RunsPage />, '/admin/process');
    expect(await screen.findByText(/всего по фильтру: 151/)).toBeTruthy();
    expect(screen.getAllByText('текст с тех пор изменился').length).toBe(2);
    expect(screen.queryByText('0 с')).toBeNull();
    expect((screen.getByRole('button', { name: 'Новее' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Старее' }));
    await waitFor(() => expect(runsCalls(api).some(u => u.includes('beforeId=150'))).toBe(true));
    expect(await screen.findByRole('link', { name: /Разбор от/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Новее' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('фильтр «Источник» — список названий, в запрос уходит номер источника', async () => {
    const api = fakeApi(around({ match: 'GET /api/reprocess/runs', respond: () => page([run(10)]) }));
    renderWithProviders(<RunsPage />, '/admin/process');

    const select = await screen.findByRole('combobox', { name: 'Источник' });
    await waitFor(() => expect(within(select).getByRole('option', { name: 'ЕРЗ.РФ' })).toBeTruthy());
    fireEvent.change(select, { target: { value: '2' } });
    await waitFor(() => expect(runsCalls(api).some(u => u.includes('sourceId=2'))).toBe(true));
    // Прежних полей по невидимым номерам и отпечатку нет.
    expect(screen.queryByLabelText(/Редакция #/)).toBeNull();
    expect(screen.queryByLabelText(/Отпечаток/)).toBeNull();
  });

  it('фильтры читаются из адреса: ?source=2&status=failed', async () => {
    const api = fakeApi(around({ match: 'GET /api/reprocess/runs', respond: () => page([]) }));
    renderWithProviders(<RunsPage />, '/admin/process?source=2&status=failed');

    await screen.findByText(/Разборов по фильтру нет/);
    expect(runsCalls(api)[0]).toMatch(/sourceId=2/);
    expect(runsCalls(api)[0]).toMatch(/status=failed/);
    expect((screen.getByRole('combobox', { name: 'Статус разбора' }) as HTMLSelectElement).value).toBe('failed');
  });

  it('счётчик «в очереди на разбор» — фильтр списка по тому же правилу, что счётчик', async () => {
    const api = fakeApi(around({ match: 'GET /api/reprocess/runs', respond: () => page([run(10)]) }));
    renderWithProviders(<RunsPage />, '/admin/process');

    const tile = await screen.findByRole('button', { name: /412.*в очереди на разбор/ });
    expect(tile.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(tile);
    await waitFor(() => expect(runsCalls(api).some(u => u.includes('state=in_queue'))).toBe(true));
    expect(screen.getByRole('button', { name: /412.*в очереди на разбор/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Тексты: в очереди на разбор')).toBeTruthy();
    // «В карточках» — не фильтр: к разборам это состояние не сводится.
    expect(screen.queryByRole('button', { name: /81\s230/ })).toBeNull();
  });

  it('«попытки исчерпаны» и «будет повтор» — разные списки; статус разбора снимает плитку', async () => {
    const api = fakeApi(around({ match: 'GET /api/reprocess/runs', respond: () => page([run(10)]) }));
    renderWithProviders(<RunsPage />, '/admin/process?status=failed');

    const exhausted = await screen.findByRole('button', { name: /4.*попытки исчерпаны/ });
    const retrying = screen.getByRole('button', { name: /10.*будет повтор/ });
    fireEvent.click(retrying);
    await waitFor(() => expect(runsCalls(api).at(-1)).toMatch(/state=failed_retrying/));
    expect(runsCalls(api).at(-1)).not.toMatch(/status=/);
    expect(retrying.getAttribute('aria-pressed')).toBe('true');
    expect(exhausted.getAttribute('aria-pressed')).toBe('false');

    fireEvent.change(screen.getByRole('combobox', { name: 'Статус разбора' }), { target: { value: 'partial' } });
    await waitFor(() => expect(runsCalls(api).at(-1)).toMatch(/status=partial/));
    expect(runsCalls(api).at(-1)).not.toMatch(/state=/);
    expect(retrying.getAttribute('aria-pressed')).toBe('false');
  });
});
