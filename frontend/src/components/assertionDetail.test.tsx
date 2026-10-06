// «Откуда известно»: на экранах чтения — цитата, источник и дата; решение оператора свёрнуто и только
// у тех, кому можно решать; цитата исключается через диалог с причиной, а не window.prompt.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, LOCAL_AUTH, type IAuthState } from '../hooks/useAuth';
import { assertionResponse } from '../test/assertionFixture';
import { fakeApi, renderWithProviders, type IFakeRoute } from '../test/render';
import { AssertionDetail } from './AssertionDetail';
import { Section } from './ui/Section';

const READER: IAuthState = { ...LOCAL_AUTH, can: permission => permission === 'portal.read' };

const routes = (over: IFakeRoute[] = []): IFakeRoute[] => [
  ...over,
  { match: 'GET /api/assertions/5', respond: () => ({ status: 200, body: assertionResponse(5) }) },
];

describe('AssertionDetail', () => {
  it('читателю — цитаты с источником-публикацией и датой, без внутренней кухни и без решения', async () => {
    fakeApi(routes());
    const { container } = renderWithProviders(
      <AuthContext.Provider value={READER}>
        <AssertionDetail assertionId={5} />
      </AuthContext.Provider>,
    );

    expect(await screen.findByText('Бета-Демо заключила договор субподряда с Дельта-Демо')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Стройка онлайн' })[0]?.getAttribute('href')).toBe('/documents/19');
    expect(screen.getAllByText('14.09.2026').length).toBeGreaterThan(0);
    const original = screen.getAllByRole('link', { name: /оригинал/ })[0];
    expect(original?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('Опровергают')).toBeTruthy();
    // Сумма — по-русски, без пересчёта.
    expect(screen.getByText(/38,1\sмлн\s₽/)).toBeTruthy();

    const text = container.textContent ?? '';
    expect(text).not.toMatch(/версия \d|уверенность модели|#\d|редакция \d|запуск/);
    expect(screen.queryByText('Решение оператора')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Исключить цитату' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'разбор' })).toBeNull();
  });

  it('исключённая цитата подписана словом, а не прозрачностью', async () => {
    fakeApi(routes());
    renderWithProviders(<AssertionDetail assertionId={5} />);

    const quote = await screen.findByText('договор с Дельта-Демо');
    const item = quote.closest('li');
    expect(item && within(item).getByText('исключена')).toBeTruthy();
    expect(item && within(item).getByText('перепечатка без первоисточника')).toBeTruthy();
    expect(item?.getAttribute('style') ?? '').not.toContain('opacity');
  });

  it('оператору «Решение оператора» свёрнуто; раскрыл — форма, история и инструменты цитат', async () => {
    fakeApi(routes());
    renderWithProviders(<AssertionDetail assertionId={5} />);
    const summary = await screen.findByText('Решение оператора');
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
    expect(screen.queryByRole('button', { name: 'Да' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Исключить цитату' })).toBeNull();

    fireEvent.click(summary);
    details?.dispatchEvent(new Event('toggle'));

    expect(await screen.findByRole('button', { name: 'Да' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Нет' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('История решений')).toBeTruthy();
    expect(screen.getByText('Обоснование этого решения не сохранилось.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Исключить цитату' }).length).toBe(2);
    expect(screen.getAllByRole('link', { name: 'разбор' })[0]?.getAttribute('href')).toBe('/admin/process/77');
  });

  it('в «Проверке» решение раскрыто сразу; «Нет» отклоняет одним нажатием, без причины', async () => {
    const api = fakeApi(routes([{ match: 'POST /api/assertions/5/reviews', respond: () => ({ status: 200, body: { ok: true } }) }]));
    renderWithProviders(<AssertionDetail assertionId={5} mode="review" />);

    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Нет' }));

    await screen.findByText('Решение записано.');
    const call = api.calls.find(c => c.method === 'POST');
    expect(call?.body).toMatchObject({ decision: 'rejected', scope: 'reflects_source', reason: null, expectedVersion: 3 });
    expect(typeof (call?.body as { idempotencyKey?: unknown }).idempotencyKey).toBe('string');
  });

  it('конфликт версий (409) — предупреждение словами, а не сырой ответ сервера', async () => {
    fakeApi(routes([{ match: 'POST /api/assertions/5/reviews', respond: () => ({ status: 409, body: { error: 'version_conflict' } }) }]));
    renderWithProviders(<AssertionDetail assertionId={5} mode="review" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Да' }));
    expect(await screen.findByText(/изменилось в другой вкладке/)).toBeTruthy();
    expect(screen.queryByText('version_conflict')).toBeNull();
  });

  it('цитата исключается через диалог с причиной, window.prompt не вызывается', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    const api = fakeApi(routes([{ match: 'POST /api/evidence/51/withdraw', respond: () => ({ status: 200, body: { ok: true } }) }]));
    renderWithProviders(<AssertionDetail assertionId={5} mode="review" />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Исключить цитату' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Исключить цитату' });
    const confirm = within(dialog).getByRole('button', { name: 'Исключить цитату' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Почему цитата не подходит/), { target: { value: 'перепечатка' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(api.calls.some(c => c.method === 'POST' && c.url === '/api/evidence/51/withdraw')).toBe(true));
    expect(api.calls.find(c => c.method === 'POST')?.body).toEqual({ reason: 'перепечатка', expectedVersion: 3 });
    expect(await screen.findByText(/Цитата исключена/)).toBeTruthy();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('уровни заголовков — из окружения: в разделе h2 сведение — h3, группы цитат — h4', async () => {
    fakeApi(routes());
    renderWithProviders(
      <Section title="Контрагенты">
        <AssertionDetail assertionId={5} />
      </Section>,
    );
    expect(await screen.findByRole('heading', { level: 3, name: /Бета-Демо/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: /Подтверждают/ })).toBeTruthy();
  });
});
