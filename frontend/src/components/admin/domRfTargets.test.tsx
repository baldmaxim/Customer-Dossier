// «Карточки» ДОМ.РФ: тысячи ссылок — страницами по 50; фильтр состояния, поиск и причина ошибки уходят
// на сервер и сбрасывают страницу; над списком — прочитано за сутки и срок для ждущих.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../../test/render';
import { DomRfTargets } from './DomRfTargets';

const HOST = 'https://xn--80az8a.xn--d1aqf.xn--p1ai';

const target = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  externalRef: String(60000 + id),
  url: `${HOST}/сервисы/каталог-новостроек/объект/${60000 + id}`,
  projectId: null,
  projectName: null,
  requestedAt: '2026-10-06T10:00:00Z',
  capturedAt: null,
  status: 'pending',
  attemptCount: 0,
  lastError: null,
  nextAttemptAt: null,
  ...over,
});

const page = (url: string) => {
  const params = new URL(url, 'http://test').searchParams;
  const filter = params.get('filter');
  const items =
    filter === 'error'
      ? [target(3, { lastError: 'страница ДОМ.РФ ответила HTTP 404', attemptCount: 7, nextAttemptAt: '2026-10-06T12:30:00Z' })]
      : [target(1), target(2, { status: 'captured', capturedAt: '2026-10-06T09:00:00Z', projectId: 5, projectName: 'ЖК Адмирал' })];
  return {
    items,
    total: filter === 'error' ? 1 : 120,
    page: Number(params.get('page')),
    limit: 50,
    counts: { all: 4700, waiting: 1200, error: 2100, captured: 1400 },
    reasons: [
      { reason: 'страница ДОМ.РФ ответила HTTP 404', count: 1500 },
      { reason: 'на странице не найден генподрядчик; снимок не сохранён', count: 600 },
    ],
    day: { captured: 400, failed: 900 },
  };
};

const lastList = (calls: Array<{ method: string; url: string }>): URLSearchParams =>
  new URL(calls.filter(c => c.method === 'GET').at(-1)!.url, 'http://test').searchParams;

describe('карточки ДОМ.РФ: фильтр и страницы', () => {
  it('числа состояний, скорость за сутки и страницы по 50', async () => {
    const api = fakeApi([{ match: 'GET /api/admin/domrf-targets', respond: url => ({ status: 200, body: page(url) }) }]);
    renderWithProviders(<DomRfTargets />);
    expect(await screen.findByRole('button', { name: /^Ошибки: 2\s100$/ })).toBeTruthy();
    expect(screen.getByText(/^За сутки прочитано 400, с ошибкой 900, ждущие 1\s200 при такой скорости — около 3 дней\.$/)).toBeTruthy();
    expect(lastList(api.calls).get('limit')).toBe('50');

    fireEvent.click(screen.getByRole('button', { name: /Вперёд/ }));
    await waitFor(() => expect(lastList(api.calls).get('page')).toBe('2'));
    expect(await screen.findByText(/51–100 из 120/)).toBeTruthy();
  });

  it('«Ошибки» — причина списком, выбор уходит на сервер с первой страницы; у ошибки — попытки', async () => {
    const api = fakeApi([{ match: 'GET /api/admin/domrf-targets', respond: url => ({ status: 200, body: page(url) }) }]);
    renderWithProviders(<DomRfTargets />, '/?page=3');
    fireEvent.click(await screen.findByRole('button', { name: /^Ошибки: 2\s100$/ }));
    await waitFor(() => expect(lastList(api.calls).get('filter')).toBe('error'));
    expect(lastList(api.calls).get('page')).toBe('1');
    expect(await screen.findByText(/7 попыток/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Причина ошибки'), { target: { value: 'на странице не найден генподрядчик; снимок не сохранён' } });
    await waitFor(() => expect(lastList(api.calls).get('reason')).toBe('на странице не найден генподрядчик; снимок не сохранён'));
  });

  it('поиск по номеру уходит на сервер с задержкой', async () => {
    const api = fakeApi([{ match: 'GET /api/admin/domrf-targets', respond: url => ({ status: 200, body: page(url) }) }]);
    renderWithProviders(<DomRfTargets />);
    fireEvent.change(await screen.findByLabelText('Номер ДОМ.РФ или объект портала'), { target: { value: '60001' } });
    await waitFor(() => expect(lastList(api.calls).get('q')).toBe('60001'));
  });
});
