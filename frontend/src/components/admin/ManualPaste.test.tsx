// Ручная вставка сохраняет публикацию и ничего не запускает: разбор портал выполняет сам.
// Ответы API синтетические; модель и сеть не участвуют.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders, type IFakeRoute } from '../../test/render';
import { ManualPaste } from './ManualPaste';

const TEXT = 'Заказчик объявил конкурс на строительство корпуса 3 жилого комплекса «Пример».';

const saved = {
  outcome: 'inserted',
  documentId: 4,
  sourceItemId: 9,
  revisionId: 7,
  revisionNo: 1,
};

const manual = (status: number, body: unknown): IFakeRoute => ({ match: 'POST /api/manual', respond: () => ({ status, body }) });

const fillText = (): void => {
  fireEvent.change(screen.getByPlaceholderText('Вставьте текст сообщения или статьи'), { target: { value: TEXT } });
};

const save = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить текст' }));
};

const statusText = async (): Promise<string> => (await screen.findAllByRole('status')).map(n => n.textContent ?? '').join(' | ');

describe('Ручная вставка текста', () => {
  it('незаполненные сведения уходят как «неизвестно», сохранение не ставит разбор', async () => {
    const api = fakeApi([manual(201, saved)]);
    renderWithProviders(<ManualPaste />);
    fillText();
    save();

    await waitFor(() => expect(api.calls.some(c => c.url.endsWith('/api/manual'))).toBe(true));
    expect(api.calls.find(c => c.url.endsWith('/api/manual'))?.body).toEqual({
      body: TEXT,
      title: null,
      url: null,
      origin: null,
      publishedAt: null,
    });
    expect(await statusText()).toMatch(/текст сохранён как новая публикация/);
    // Сохранение — не разбор: модель не вызывается и разбор сам не ставится.
    expect(api.calls.some(c => c.url.includes('/api/reprocess'))).toBe(false);
  });

  it('заполненные сведения уходят как введены, время — с явным смещением', async () => {
    const api = fakeApi([manual(201, saved)]);
    renderWithProviders(<ManualPaste />);
    fillText();
    fireEvent.change(screen.getByLabelText('Заголовок'), { target: { value: 'Конкурс на корпус 3' } });
    fireEvent.change(screen.getByLabelText('Ссылка на первоисточник'), { target: { value: 'https://example.ru/news/1' } });
    fireEvent.change(screen.getByLabelText('Откуда взято'), { target: { value: 'канал «Пример»' } });
    fireEvent.change(screen.getByLabelText('Дата и время публикации'), { target: { value: '2026-09-18T10:30' } });
    save();

    await waitFor(() => expect(api.calls.some(c => c.url.endsWith('/api/manual'))).toBe(true));
    expect(api.calls.find(c => c.url.endsWith('/api/manual'))?.body).toEqual({
      body: TEXT,
      title: 'Конкурс на корпус 3',
      url: 'https://example.ru/news/1',
      origin: 'канал «Пример»',
      // Введено местное время — уходит момент времени, а не строка без пояса.
      publishedAt: new Date('2026-09-18T10:30').toISOString(),
    });
  });

  it('после сохранения — ссылка на публикацию; разбор не ставится руками, портал разберёт сам', async () => {
    const api = fakeApi([manual(201, saved)]);
    renderWithProviders(<ManualPaste />);
    fillText();
    save();

    expect(await statusText()).toMatch(/текст сохранён как новая публикация/);
    expect(screen.getByText(/Портал разберёт текст сам/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Открыть публикацию' }).getAttribute('href')).toBe('/documents/4');
    expect(screen.queryByRole('button', { name: /разбор/i })).toBeNull();
    // Ни одна кнопка панели не обращается к обработке.
    expect(api.calls.some(c => c.url.includes('/api/reprocess'))).toBe(false);
  });

  it('короткий текст не сохранён — сказано словами', async () => {
    fakeApi([manual(200, { outcome: 'too_short', documentId: null, sourceItemId: null, revisionId: null, revisionNo: null })]);
    renderWithProviders(<ManualPaste />);
    fillText();
    save();

    expect(await statusText()).toMatch(/слишком короткий/);
    expect(screen.getByText('Текст не сохранён.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Открыть публикацию' })).toBeNull();
  });

  it('без допуска источника — причина и что сделать, а не «Ошибка 403»', async () => {
    fakeApi([manual(403, { error: 'Источник «form»: нет разрешения на сбор — основание не подтверждено', code: 'source_policy' })]);
    renderWithProviders(<ManualPaste />);
    fillText();
    save();

    const text = (await screen.findByRole('alert')).textContent ?? '';
    expect(text).toMatch(/нет разрешения на сбор/);
    expect(text).toMatch(/Ручную вставку текста/);
    expect(text).not.toMatch(/CSRF/);
  });
});
