// Страница публикации: только сам пост, в виде Telegram. Ответы API синтетические.
//
// Служебный разбор и редакции сняты с экрана (решение владельца 23.09.2026): тест
// сторожит, чтобы они не вернулись незаметно. Одна новость в нескольких каналах —
// переключатель источника, выбранный канал — в адресе (?source=).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithRouter, type IFakeRoute } from '../test/render';
import { stubViewport } from '../test/viewport';
import { DocumentPage } from './DocumentPage';

/** Страница читает id и источник из адреса, поэтому рисуется маршрутом. */
const renderPage = (url = '/documents/19') => renderWithRouter([{ path: '/documents/:id', element: <DocumentPage /> }], [url]);

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

const twoChannels = () => [item(), item({ id: 6, sourceTitle: 'Стройка онлайн', sourceKey: 'stroy', latestRevisionId: 10, publishedAt: null })];

describe('Страница публикации', () => {
  it('показывает сам пост: канал по имени, дату, текст и ссылку в Telegram', async () => {
    fakeApi(routes());
    renderPage();

    expect(await screen.findByText(/Это проект рядом с Новыми Ватутинками/)).toBeTruthy();
    expect(screen.getAllByText(/^Недвижимость изнутри/).length).toBeGreaterThan(0);
    // Год не проверяем: в текущем году он не печатается, и тест не должен зависеть от даты запуска.
    expect(screen.getAllByText(/^14 сентября/).length).toBeGreaterThan(0);
    // Ссылка на оригинал — сама шапка канала, а не кнопка под текстом.
    expect(
      screen.getByRole('link', { name: 'Недвижимость изнутри — открыть оригинал в Telegram' }).getAttribute('href'),
    ).toBe('https://t.me/propertyinsider/36274');
    // Фото портал не хранит — сказано словами, а не молча пропущено.
    expect(screen.getByText(/фото — не сохраняется, открыть можно в оригинале/)).toBeTruthy();
    // Заголовок страницы — для диктора: тема поста, составленная моделью, а не «Публикация №…».
    expect(screen.getByRole('heading', { level: 1, name: 'Новый жилой проект рядом с Новыми Ватутинками' })).toBeTruthy();
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

    expect((await screen.findAllByText(/^@propertyinsider/)).length).toBeGreaterThan(0);
  });

  it('та же новость в другом канале — списком каналов, выбранный канал попадает в адрес', async () => {
    fakeApi(routes(twoChannels()));
    const { router } = renderPage();
    await screen.findByText(/Это проект рядом с Новыми Ватутинками/);

    const channels = screen.getByRole('navigation', { name: /^Эта же новость в 2\sканалах$/ });
    expect(within(channels).getByRole('link', { name: 'Недвижимость изнутри' }).getAttribute('aria-current')).toBe('true');
    // Без даты публикации в списке сказано, что время — когда портал её увидел.
    expect(within(channels).getByText(/^замечена 14 сентября/)).toBeTruthy();
    fireEvent.click(within(channels).getByRole('link', { name: 'Стройка онлайн' }));

    expect(await screen.findByText('Перепечатка в другом канале.')).toBeTruthy();
    expect(router.state.location.search).toBe('?source=6');
    // Смена канала — не переход: «Назад» ведёт с публикации, а не на прежний канал.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('канал из адреса открывается сразу', async () => {
    fakeApi(routes(twoChannels()));
    renderPage('/documents/19?source=6');
    expect(await screen.findByText('Перепечатка в другом канале.')).toBeTruthy();
  });

  it('на телефоне каналы — выпадающим списком, а не облаком кнопок', async () => {
    stubViewport(390);
    fakeApi(routes(twoChannels()));
    const { router } = renderPage();
    const select = (await screen.findByLabelText('Эта же новость в 2 каналах')) as HTMLSelectElement;
    expect(screen.queryByRole('navigation', { name: /Эта же новость/ })).toBeNull();

    fireEvent.change(select, { target: { value: '6' } });
    await waitFor(() => expect(router.state.location.search).toBe('?source=6'));
    expect(await screen.findByText('Перепечатка в другом канале.')).toBeTruthy();
  });

  it('текста нет — сказано, что делать; неизвестная публикация — «не найдена»', async () => {
    fakeApi(routes([]));
    renderPage();
    expect(await screen.findByText('Текст не сохранён — откройте оригинал.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'К публикациям' }).getAttribute('href')).toBe('/?view=publications');
  });

  it('404 — «Публикация не найдена», а не пустая страница', async () => {
    fakeApi([{ match: 'GET /api/documents/19/items', respond: () => ({ status: 404, body: { error: 'not found' } }) }]);
    renderPage();
    expect(await screen.findByText('Публикация не найдена')).toBeTruthy();
  });
});
