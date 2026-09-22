// Страница документа: что оператор должен увидеть важного и почему бывает пусто.
//
// Три исхода различаются словами: взято в карточки, текст не о стройке, разбора не было.
// Ответы API синтетические.
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders, type IFakeRoute } from '../test/render';
import { DocumentPage } from './DocumentPage';

/** Страница читает id из адреса, поэтому рисуется маршрутом, а не напрямую. */
const renderPage = () =>
  renderWithProviders(
    <Routes>
      <Route path="/documents/:id" element={<DocumentPage />} />
    </Routes>,
    '/documents/19',
  );

const item = (over: Record<string, unknown> = {}) => ({
  id: 5,
  sourceId: 2,
  sourceTitle: 'm0n1ch',
  sourceKind: 'telegram',
  itemKey: 'tg:m0n1ch/36274',
  externalId: 'm0n1ch/36274',
  canonicalUrl: null,
  originalUrl: 'https://t.me/m0n1ch/36274',
  publishedAt: '2026-09-21T11:50:00Z',
  state: 'present',
  deletedObservedAt: null,
  firstObservedAt: '2026-09-21T11:50:00Z',
  lastObservedAt: '2026-09-21T11:50:00Z',
  latestRevisionId: 9,
  historyBeforeImport: 'complete',
  origin: 'ingest',
  revisionCount: 1,
  title: null,
  latestCompleteness: 'full',
  latestCompletenessReason: null,
  topic: 'Объединение Москвы и области и цены жилья',
  topicModel: 'qwen3-8b',
  topicVersion: 'headline@1',
  ...over,
});

const outcome = (over: Record<string, unknown> = {}) => ({
  state: 'in_cards',
  policy: { allowed: true, reason: null },
  run: { id: 3, status: 'completed', error: null, finishedAt: '2026-09-21T11:52:00Z', coveredChars: 120, totalChars: 120, relevant: true, revisionNo: 1 },
  activeSetId: 4,
  assertions: [
    {
      id: 77,
      predicate: 'participates_in_project',
      role: 'general_contractor',
      eventType: null,
      polarity: 'positive',
      modality: 'reported_fact',
      status: 'text_grounded',
      validFrom: null,
      periodPrecision: 'unknown',
      parties: [
        { kind: 'company', id: 42, name: 'ООО «Пример»', side: 'subject' },
        { kind: 'project', id: 8, name: 'ЖК «Пример»', side: 'object' },
      ],
      quotes: [{ quote: 'генподрядчиком выступает ООО «Пример»', spanStart: 10, spanEnd: 47, stance: 'supports' }],
    },
  ],
  companies: [{ id: 42, name: 'ООО «Пример»' }],
  projects: [{ id: 8, name: 'ЖК «Пример»' }],
  ...over,
});

const revision = {
  id: 9,
  sourceItemId: 5,
  revisionNo: 1,
  title: null,
  body: ['Генподрядчиком ЖК «Пример» выступает ООО «Пример».', '', 'Работы начнутся осенью.'].join('\n'),
  representation: 'telegram_web_text@1',
  bodyHash: 'abc',
  completeness: 'full',
  completenessReason: null,
  attachments: [],
  publishedAt: '2026-09-21T11:50:00Z',
  sourceModifiedAt: null,
  firstObservedAt: '2026-09-21T11:50:00Z',
  chronology: 'observed_order',
  sameContentAsRevisionId: null,
  legacyDocumentId: 19,
  origin: 'ingest',
};

const routes = (over: Record<string, unknown> = {}, items = [item()]): IFakeRoute[] => [
  { match: 'GET /api/documents/19/items', respond: () => ({ status: 200, body: { items } }) },
  { match: 'GET /api/items/5/extraction', respond: () => ({ status: 200, body: outcome(over) }) },
  { match: 'GET /api/items/5/revisions', respond: () => ({ status: 200, body: { items: [] } }) },
  { match: 'GET /api/revisions/9', respond: () => ({ status: 200, body: { revision } }) },
];

describe('Страница документа', () => {
  it('тема от модели подписана как машинная, взятое ведёт в карточки', async () => {
    fakeApi(routes());
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Объединение Москвы и области и цены жилья' })).toBeTruthy();
    expect(screen.getByText('тема составлена моделью')).toBeTruthy();
    expect(await screen.findByText('разобрано, сведения в карточках')).toBeTruthy();
    // У ссылки подписан вид карточки: «А101» и «Деснаречье» вели в разные разделы неразличимо.
    expect((await screen.findAllByRole('link', { name: /ООО «Пример».*компания/ }))[0]?.getAttribute('href')).toBe(
      '/company/42',
    );
    expect(screen.getByText(/генподрядчиком выступает/)).toBeTruthy();
    expect(screen.getByText(/не то, что это правда/)).toBeTruthy();
  });

  it('текст публикации показан на странице, а не спрятан под разбором', async () => {
    fakeApi(routes());
    renderPage();

    // За этим сюда и приходят из карточки компании: прочитать саму новость.
    expect(await screen.findByText(/Работы начнутся осенью/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Текст публикации' })).toBeTruthy();
  });

  it('стороны утверждения не дублируют ссылки: они текстом', async () => {
    fakeApi(routes());
    renderPage();

    await screen.findByText('разобрано, сведения в карточках');
    // Ровно одна ссылка на карточку компании — в общем блоке, а не ещё раз в утверждении.
    expect(screen.getAllByRole('link', { name: /ООО «Пример»/ })).toHaveLength(1);
    expect(screen.getByText('ООО «Пример» · ЖК «Пример»')).toBeTruthy();
  });

  it('нерелевантный текст: сказано, что взято ничего и почему', async () => {
    fakeApi(
      routes({
        state: 'not_relevant',
        activeSetId: 4,
        run: { id: 3, status: 'completed', error: null, finishedAt: '2026-09-21T11:52:00Z', coveredChars: 120, totalChars: 120, relevant: false, revisionNo: 1 },
        assertions: [],
        companies: [],
        projects: [],
      }),
    );
    renderPage();

    expect(await screen.findByText('текст признан не относящимся к стройке и недвижимости')).toBeTruthy();
    expect(screen.getByText(/в карточки не взято ничего/)).toBeTruthy();
  });

  it('разбора не было: это не «ничего нет», а отсутствие разбора; заголовок источника важнее темы', async () => {
    fakeApi(
      routes(
        { state: 'no_run', run: null, activeSetId: null, assertions: [], companies: [], projects: [] },
        [item({ title: 'Конкурс на корпус 3' })],
      ),
    );
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Конкурс на корпус 3' })).toBeTruthy();
    expect(screen.queryByText('тема составлена моделью')).toBeNull();
    expect(await screen.findByText('ещё не разбирался')).toBeTruthy();
  });
});
