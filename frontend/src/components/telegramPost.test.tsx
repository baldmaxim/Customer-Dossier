// Пост и сохранённая публикация поверх страницы: ссылки в тексте кликабельны и безопасны,
// вид источника — словами из словаря, диалог возвращает фокус туда, откуда его открыли.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../test/render';
import { PublicationSourceButton } from './PublicationModal';
import { TelegramPost } from './TelegramPost';

const revision = (body: string, over: Record<string, unknown> = {}) => ({
  revision: {
    id: 9, sourceItemId: 5, revisionNo: 1, title: null, body, representation: 'telegram_web_text@1', bodyHash: 'x',
    completeness: 'full', completenessReason: null, attachments: [], publishedAt: '2026-09-20T09:00:00Z', sourceModifiedAt: null,
    firstObservedAt: '2026-09-20T09:05:00Z', chronology: 'observed_order', sameContentAsRevisionId: null, legacyDocumentId: 19, origin: 'ingest',
    ...over,
  },
});

const post = (over: Partial<Parameters<typeof TelegramPost>[0]> = {}) => (
  <TelegramPost
    revisionId={9}
    sourceTitle="Стройканал"
    sourceKey="stroykanal"
    sourceKind="telegram"
    publishedAt="2026-09-20T09:00:00Z"
    observedAt="2026-09-20T09:05:00Z"
    url="https://t.me/stroykanal/9"
    title={null}
    {...over}
  />
);

describe('TelegramPost', () => {
  it('картинки поста: фото — копия с портала, обложка видео ведёт к оригиналу, несохранённое — словами', async () => {
    fakeApi([{
      match: 'GET /api/revisions/9',
      respond: () => ({ status: 200, body: revision('Альбом со стройки', {
        completeness: 'caption_only',
        attachments: [{ kind: 'photo', status: 'unsupported' }, { kind: 'video', status: 'unsupported' }, { kind: 'document', status: 'unsupported' }],
        images: {
          items: [
            { n: 0, kind: 'photo', width: 1280, height: 960 },
            { n: 2, kind: 'video', width: 1280, height: 720 },
          ],
          missing: 1,
        },
      }) }),
    }]);
    renderWithProviders(post());

    const photo = await screen.findByRole('img', { name: 'Фото 1 из 2' });
    expect(photo.getAttribute('src')).toBe('/api/items/5/images/0');
    expect(screen.getByRole('link', { name: 'Фото 1 из 2 — открыть крупнее' }).getAttribute('href')).toBe('/api/items/5/images/0');
    expect(screen.getByRole('img', { name: 'Обложка видео 2 из 2' }).getAttribute('src')).toBe('/api/items/5/images/2');
    expect(screen.getByRole('link', { name: 'Видео 2 из 2 — открыть в оригинале' }).getAttribute('href')).toBe('https://t.me/stroykanal/9');
    expect(screen.getByText(/^файл — не сохраняется/)).toBeTruthy();
    expect(screen.queryByText(/^фото/)).toBeNull();
    expect(screen.getByText('Сохранено 2 из 3 картинок — остальные есть в оригинале.')).toBeTruthy();
  });

  it('пост без сохранённых картинок — вложения словами, как раньше', async () => {
    fakeApi([{
      match: 'GET /api/revisions/9',
      respond: () => ({ status: 200, body: revision('Подпись', { attachments: [{ kind: 'photo', status: 'unsupported' }], images: null }) }),
    }]);
    renderWithProviders(post());

    expect(await screen.findByText(/^фото — не сохраняется/)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('снимок ДОМ.РФ: характеристики и генподрядчик отдельно от исходного текста', async () => {
    fakeApi([{
      match: 'GET /api/revisions/9',
      respond: () => ({ status: 200, body: revision(
        'Объект: «СОБЫТИЕ» (ID 68275 в реестре)\nСдача дома: I кв. 2029\nКоличество квартир: 507\nГенподрядчики: ООО СУ-10 (ИНН: 7736255508)',
        { title: 'СОБЫТИЕ', representation: 'registry_object_browser@1', completeness: 'excerpt', publishedAt: null },
      ) }),
    }]);
    renderWithProviders(post({ sourceKind: 'website', sourceTitle: 'наш.дом.рф', sourceKey: 'domrf', url: null }));

    const heading = await screen.findByRole('heading', { name: 'Характеристики объекта' });
    const panel = heading.parentElement!;
    expect(panel.textContent).toContain('ГенподрядчикиООО СУ-10 (ИНН: 7736255508)');
    expect(panel.textContent).toContain('Сдача домаI кв. 2029');
    expect(screen.getByText(/^Исходный текст/).closest('details')?.open).toBe(false);
  });

  it('http(s)-адреса в тексте — ссылки наружу, другие схемы остаются текстом', async () => {
    fakeApi([{ match: 'GET /api/revisions/9', respond: () => ({ status: 200, body: revision('Подробнее: https://example.ru/news/1. И javascript:alert(1)') }) }]);
    renderWithProviders(post());

    const link = await screen.findByRole('link', { name: 'https://example.ru/news/1' });
    expect(link.getAttribute('href')).toBe('https://example.ru/news/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByRole('link', { name: /javascript/ })).toBeNull();
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeTruthy();
  });

  it('у поста есть заголовок для диктора; вид источника без ссылки — словом из словаря', async () => {
    fakeApi([{ match: 'GET /api/revisions/9', respond: () => ({ status: 200, body: revision('Текст с сайта.') }) }]);
    renderWithProviders(post({ sourceKind: 'website', sourceTitle: 'ЕРЗ', sourceKey: 'erzrf.ru', url: null }));

    expect(await screen.findByText('Текст с сайта.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Публикация: ЕРЗ, 20 сентября/ })).toBeTruthy();
    expect(screen.getByText('сайт')).toBeTruthy();
    expect(screen.queryByText(/вставлено вручную/)).toBeNull();
  });

  it('текст не загрузился — сообщение и «Повторить», а не пустой пузырь', async () => {
    fakeApi([{ match: 'GET /api/revisions/9', respond: () => ({ status: 500, body: { error: 'сбой' } }) }]);
    renderWithProviders(post());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Текст не загрузился');
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});

describe('Сохранённая публикация поверх страницы', () => {
  it('открывается диалогом с текстом, закрытие возвращает фокус на источник', async () => {
    fakeApi([{ match: 'GET /api/revisions/9', respond: () => ({ status: 200, body: revision('Сохранённый текст сообщения об объекте.') }) }]);
    renderWithProviders(
      <PublicationSourceButton
        source={{
          sourceTitle: 'Стройканал', sourceKey: 'stroykanal', sourceKind: 'telegram',
          url: 'https://t.me/stroykanal/44', observedAt: '2026-09-18T07:30:00Z', title: null, revisionId: 9,
          publishedAt: '2026-09-18T07:00:00Z',
        }}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Стройканал — открыть публикацию' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Публикация: Стройканал' });
    expect(await within(dialog).findByText('Сохранённый текст сообщения об объекте.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть публикацию' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
