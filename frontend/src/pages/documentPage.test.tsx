// Страница публикации: только сам пост, в виде Telegram. Ответы API синтетические.
//
// Служебный разбор и редакции сняты с экрана (решение владельца 23.09.2026): тест
// сторожит, чтобы они не вернулись незаметно.
import { fireEvent, screen } from '@testing-library/react';
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
  sourceTitle: 'Недвижимость изнутри',
  sourceKind: 'telegram',
  sourceKey: 'propertyinsider',
  itemKey: 'tg:propertyinsider/36274',
  externalId: 'propertyinsider/36274',
  canonicalUrl: null,
  originalUrl: 'https://t.me/propertyinsider/36274',
  publishedAt: '2026-09-14T08:20:00Z',
  state: 'present',
  deletedObservedAt: null,
  firstObservedAt: '2026-09-14T08:25:00Z',
  lastObservedAt: '2026-09-14T08:25:00Z',
  latestRevisionId: 9,
  historyBeforeImport: 'complete',
  origin: 'ingest',
  revisionCount: 1,
  title: null,
  latestCompleteness: 'caption_only',
  latestCompletenessReason: null,
  topic: 'Новый жилой проект рядом с Новыми Ватутинками',
  topicModel: 'qwen3-8b',
  topicVersion: 'headline@1',
  ...over,
});

const revision = {
  id: 9,
  sourceItemId: 5,
  revisionNo: 1,
  title: null,
  body: ['А101 выходит «Деснаречье».', '', 'Это проект рядом с Новыми Ватутинками.'].join('\n'),
  representation: 'telegram_web_text@1',
  bodyHash: 'abc',
  completeness: 'caption_only',
  completenessReason: null,
  attachments: [{ kind: 'photo', status: 'unsupported' }],
  publishedAt: '2026-09-14T08:20:00Z',
  sourceModifiedAt: null,
  firstObservedAt: '2026-09-14T08:25:00Z',
  chronology: 'observed_order',
  sameContentAsRevisionId: null,
  legacyDocumentId: 19,
  origin: 'ingest',
};

const routes = (items = [item()]): IFakeRoute[] => [
  { match: 'GET /api/documents/19/items', respond: () => ({ status: 200, body: { items } }) },
  { match: 'GET /api/revisions/9', respond: () => ({ status: 200, body: { revision } }) },
  { match: 'GET /api/revisions/10', respond: () => ({ status: 200, body: { revision: { ...revision, id: 10, body: 'Перепечатка в другом канале.' } } }) },
];

describe('Страница публикации', () => {
  it('показывает сам пост: канал по имени, дату, текст и ссылку в Telegram', async () => {
    fakeApi(routes());
    renderPage();

    expect(await screen.findByText(/Это проект рядом с Новыми Ватутинками/)).toBeTruthy();
    expect(screen.getByText(/^Недвижимость изнутри/)).toBeTruthy();
    // Год не проверяем: в текущем году он не печатается, и тест не должен зависеть от даты запуска.
    expect(screen.getByText(/^14 сентября/)).toBeTruthy();
    // Ссылка на оригинал — сама шапка канала, а не кнопка под текстом.
    expect(
      screen.getByRole('link', { name: 'Недвижимость изнутри — открыть оригинал в Telegram' }).getAttribute('href'),
    ).toBe('https://t.me/propertyinsider/36274');
    // Фото портал не хранит — сказано словами, а не молча пропущено.
    expect(screen.getByText(/фото — не сохраняется, открыть можно в оригинале/)).toBeTruthy();
  });

  it('служебного разбора и таблицы редакций на странице нет', async () => {
    fakeApi(routes());
    renderPage();
    await screen.findByText(/Это проект рядом с Новыми Ватутинками/);

    expect(screen.queryByText('Что портал взял из этого текста')).toBeNull();
    expect(screen.queryByText('Редакции публикации')).toBeNull();
    expect(screen.queryByText(/модальность/)).toBeNull();
  });

  it('пока имя канала не собрано, вместо голого ключа — «@ключ»', async () => {
    fakeApi(routes([item({ sourceTitle: 'propertyinsider' })]));
    renderPage();

    expect(await screen.findByText(/^@propertyinsider/)).toBeTruthy();
  });

  it('та же новость в другом канале открывается переключателем', async () => {
    fakeApi(routes([item(), item({ id: 6, sourceTitle: 'Стройка онлайн', sourceKey: 'stroy', latestRevisionId: 10 })]));
    renderPage();
    await screen.findByText(/Это проект рядом с Новыми Ватутинками/);

    fireEvent.click(screen.getByRole('button', { name: 'Стройка онлайн' }));
    expect(await screen.findByText('Перепечатка в другом канале.')).toBeTruthy();
  });
});
