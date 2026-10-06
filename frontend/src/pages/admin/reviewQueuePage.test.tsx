// «Проверка»: три вкладки (противоречия · неясные упоминания · дубли) с числами, вкладка — в
// адресе; противоречие — строкой «о чём сведение», раскрытие — обе версии рядом; объединение
// дублей и «это разные» — только после подтверждения.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IFakeRoute } from '../../test/render';
import { fakeApi, renderWithRouter } from '../../test/render';
import { ReviewQueuePage } from './ReviewQueuePage';

const assertion = (id: number, polarity: 'positive' | 'negative') => ({
  assertion: {
    id,
    predicate: 'participates_in_project',
    role: 'general_contractor',
    eventType: null,
    subjectCompanyId: 7,
    subjectCompanyName: 'ООО «Ромашка»',
    subjectProjectId: null,
    subjectProjectName: null,
    subjectText: null,
    objectCompanyId: null,
    objectCompanyName: null,
    objectProjectId: 55,
    objectProjectName: 'ЖК «Северная долина»',
    objectText: null,
    counterpartyCompanyName: null,
    contextProjectName: null,
    polarity,
    workPackageLabel: null,
    attributedTo: null,
    caseNumber: null,
    proceduralRole: null,
    counterpartyRole: null,
    eventStage: null,
    eventOutcome: null,
    taxBasis: null,
    periodPrecision: 'unknown',
    scopeBuilding: null,
    workPackage: null,
    validFrom: null,
    validTo: null,
    modality: 'reported_fact',
    valueType: null,
    valueNumeric: null,
    valueCurrency: null,
    status: 'text_grounded',
    needsRevalidation: false,
    version: 1,
    confidenceExtraction: null,
    origin: 'extraction',
    supportsCount: 1,
    contradictsCount: 0,
  },
  evidence: [],
  reviews: [],
});

const QUEUE: Record<string, unknown[]> = {
  polarity_conflict: [
    {
      priority: 2,
      kind: 'polarity_conflict',
      refId: 121,
      assertionId: 121,
      detail: { negativeAssertionId: 124 },
      since: '2026-09-28T10:00:00Z',
    },
  ],
  role_period_conflict: [],
  correction: [{ priority: 3, kind: 'correction', refId: 101, assertionId: 101, detail: {}, since: '2026-09-26T10:00:00Z' }],
  dispute: [],
};

const MERGE_PREVIEW = {
  kind: 'company',
  source: {
    id: 72,
    name: 'ООО «СЗСК»',
    version: 3,
    mergedIntoId: null,
    city: null,
    legalForm: 'ООО',
    entityType: 'legal_entity',
    projectLevel: null,
    parentProjectId: null,
    identifiers: [{ type: 'RU:inn', value: '7802000000' }],
    aliases: [],
  },
  target: {
    id: 7,
    name: 'ООО «Ромашка»',
    version: 12,
    mergedIntoId: null,
    city: 'Москва',
    legalForm: 'ООО',
    entityType: 'legal_entity',
    projectLevel: null,
    parentProjectId: null,
    identifiers: [],
    aliases: [],
  },
  conflicts: [],
  warnings: [],
  counts: { assertions: 14 },
  reviewedAssertions: [],
  canApply: true,
  previewToken: 'f'.repeat(64),
};

const routes = (): IFakeRoute[] => [
  {
    match: 'GET /api/review-queue',
    respond: url => ({ status: 200, body: { items: QUEUE[new URL(url, 'http://x').searchParams.get('kind') ?? ''] ?? [] } }),
  },
  { match: 'GET /api/assertions/121', respond: () => ({ status: 200, body: assertion(121, 'positive') }) },
  { match: 'GET /api/assertions/124', respond: () => ({ status: 200, body: assertion(124, 'negative') }) },
  { match: 'GET /api/assertions/101', respond: () => ({ status: 200, body: assertion(101, 'positive') }) },
  {
    match: 'GET /api/entities/ambiguities',
    respond: () => ({
      status: 200,
      body: {
        items: [
          {
            id: 7,
            entityKind: 'company',
            surface: 'Северо-Западная корпорация',
            candidateIds: [1, 2],
            revisionId: 5,
            occurrences: 1,
            status: 'open',
            version: 1,
            updatedAt: '2026-09-17T10:00:00Z',
          },
        ],
        total: 250,
        nextCursor: null,
      },
    }),
  },
  { match: 'GET /api/admin/merges/31/preview', respond: () => ({ status: 200, body: MERGE_PREVIEW }) },
  { match: 'POST /api/admin/merges/31/merge', respond: () => ({ status: 201, body: { mergeId: 9, replayed: false } }) },
  { match: 'POST /api/admin/merges/31/reject', respond: () => ({ status: 200, body: { ok: true } }) },
  {
    match: 'GET /api/admin/merges',
    respond: () => ({
      status: 200,
      body: {
        items: [
          {
            id: 31,
            entityKind: 'company',
            score: 0.874,
            reasons: {},
            sourceName: 'ООО «СЗСК»',
            targetName: 'ООО «Ромашка»',
            sourceId: 72,
            targetId: 7,
            sampleDocumentId: null,
          },
        ],
      },
    }),
  },
  { match: 'GET /api/entities/merges', respond: () => ({ status: 200, body: { items: [] } }) },
];

const open = (path: string) => {
  const api = fakeApi(routes());
  const view = renderWithRouter([{ path: '/admin/review', element: <ReviewQueuePage /> }], [path]);
  return { api, ...view };
};

const tab = (name: RegExp): HTMLElement => within(screen.getByRole('tablist', { name: 'Очереди проверки' })).getByRole('tab', { name });

describe('«Проверка»: вкладки', () => {
  it('числа на вкладках: противоречия по всем видам, неясные упоминания — всего, дубли', async () => {
    open('/admin/review');
    await waitFor(() => expect(tab(/^Противоречия/).textContent).toMatch(/2$/));
    await waitFor(() => expect(tab(/^Неясные упоминания/).textContent).toMatch(/250$/));
    await waitFor(() => expect(tab(/^Дубли/).textContent).toMatch(/1$/));
    expect(tab(/^Противоречия/).getAttribute('aria-selected')).toBe('true');
  });

  it('вкладка берётся из адреса и пишется в него', async () => {
    const { router } = open('/admin/review?tab=mentions');
    expect(tab(/^Неясные упоминания/).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('«Северо-Западная корпорация»')).toBeTruthy();

    fireEvent.click(tab(/^Дубли/));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=duplicates'));
    expect(await screen.findByText('История объединений')).toBeTruthy();

    fireEvent.click(tab(/^Противоречия/));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });
});

describe('«Проверка»: противоречия', () => {
  it('строка — о чём сведение и вид словами; раскрытие — обе версии рядом, раскрытая строка — в адресе', async () => {
    const { router } = open('/admin/review');
    const title = await screen.findByText('ООО «Ромашка» — генподрядчик на объекте ЖК «Северная долина»');
    expect(screen.getByText(/противоречие источников · с/)).toBeTruthy();
    // Номера приоритета («П2 ·») больше нет.
    expect(screen.queryByText(/^П\d/)).toBeNull();

    fireEvent.click(title);
    await waitFor(() => expect(router.state.location.search).toMatch(/open=polarity_conflict-121-124/));
    expect(await screen.findByRole('heading', { name: 'Сведение' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Отрицание' })).toBeTruthy();
  });

  it('вид — фильтр в адресе', async () => {
    const { router } = open('/admin/review?kind=correction');
    expect(await screen.findByText(/цитаты изменились после решения · с/)).toBeTruthy();
    expect(screen.queryByText(/противоречие источников · с/)).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Вид' }), { target: { value: 'all' } });
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });
});

describe('«Проверка»: дубли', () => {
  it('«Сравнить» — только смотреть: кнопки объединения в сравнении нет', async () => {
    open('/admin/review?tab=duplicates');
    expect(await screen.findByText('сходство 87 %')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сравнить' }));
    expect(await screen.findByText('ИНН 7802000000')).toBeTruthy();
    // Номеров карточек и версий на экране нет.
    expect(screen.queryByText(/#72|версия 3/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Объединить' })).toBeNull();
  });

  it('«Да» объединяет сразу по токену свежего сравнения, без подтверждения', async () => {
    const { api } = open('/admin/review?tab=duplicates');
    fireEvent.click(await screen.findByRole('button', { name: 'Да, объединить' }));
    await waitFor(() =>
      expect(api.calls.find(c => c.url === '/api/admin/merges/31/merge')?.body).toMatchObject({
        expectedSourceVersion: 3,
        expectedTargetVersion: 12,
        expectedPreviewToken: 'f'.repeat(64),
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('«Нет» убирает пару сразу, без подтверждения', async () => {
    const { api } = open('/admin/review?tab=duplicates');
    fireEvent.click(await screen.findByRole('button', { name: 'Нет, разные компании' }));
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/admin/merges/31/reject')).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
