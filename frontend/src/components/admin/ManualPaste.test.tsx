// Первое досье: ручная вставка сохраняет публикацию, разбор ставится отдельным действием по редакции.
// Ответы API синтетические; модель и сеть не участвуют.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useState, type ReactElement } from 'react';

import { fakeApi, renderWithProviders, type IFakeRoute } from '../../test/render';
import { ManualPaste } from './ManualPaste';

/**
 * Панель сообщает об исходе наружу, а показывает его ступень «Сбор». Обёртка
 * повторяет это поведение, иначе тест проверял бы не то, что видит оператор.
 */
const Harness = (): ReactElement => {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      {notice && <div role="status">{notice}</div>}
      <ManualPaste onNotice={setNotice} />
    </>
  );
};

/** Панель зовёт только /api/manual и постановку разбора — соседей глушить нечего. */
const QUIET: IFakeRoute[] = [];

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
    const api = fakeApi([...QUIET, manual(201, saved)]);
    renderWithProviders(<Harness />);
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
    // Сохранение — не разбор: модель не вызывается и запуск сам не ставится.
    expect(api.calls.some(c => c.url.includes('/api/reprocess'))).toBe(false);
  });

  it('заполненные сведения уходят как введены, время — с явным смещением', async () => {
    const api = fakeApi([...QUIET, manual(201, saved)]);
    renderWithProviders(<Harness />);
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

  it('после сохранения запуск ставится вручную; выключенный исполнитель назван', async () => {
    const api = fakeApi([
      ...QUIET,
      manual(201, saved),
      { match: 'POST /api/reprocess/revisions/7/runs', respond: () => ({ status: 201, body: { outcome: 'queued', runId: 12, pipelineEnabled: false } }) },
    ]);
    renderWithProviders(<Harness />);
    fillText();
    save();

    fireEvent.click(await screen.findByRole('button', { name: 'Поставить на разбор' }));
    await waitFor(() => expect(api.calls.some(c => c.url.endsWith('/api/reprocess/revisions/7/runs'))).toBe(true));
    const text = await statusText();
    expect(text).toMatch(/запуск поставлен/);
    expect(text).toMatch(/pipeline:once/);
    expect(screen.getByRole('link', { name: 'запуск #12' })).toBeTruthy();
  });

  it('короткий текст не сохранён — ставить на разбор нечего', async () => {
    fakeApi([...QUIET, manual(200, { outcome: 'too_short', documentId: null, sourceItemId: null, revisionId: null, revisionNo: null })]);
    renderWithProviders(<Harness />);
    fillText();
    save();

    expect(await statusText()).toMatch(/слишком короткий/);
    expect(screen.queryByRole('button', { name: 'Поставить на разбор' })).toBeNull();
  });

  it('без допуска источника — причина и куда идти за решением, а не «Ошибка 403»', async () => {
    fakeApi([
      ...QUIET,
      manual(403, { error: 'Источник «form»: нет разрешения на сбор — основание не подтверждено', code: 'source_policy' }),
    ]);
    renderWithProviders(<Harness />);
    fillText();
    save();

    const text = await statusText();
    expect(text).toMatch(/нет разрешения на сбор/);
    expect(text).toMatch(/Ручная вставка текста/);
    expect(text).not.toMatch(/CSRF/);
  });
});
