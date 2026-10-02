// «Компании на ДОМ.РФ» (этап 20D, шаг 2): найденное поиском — «Это он» / «Не он», ссылка вручную,
// повторный поиск; фильтр и поиск по названию — на сервере; без права sources.manage решений нет.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { AccessPermission, IDomRfCompanies } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../../test/render';
import { DomRfCompanies } from './DomRfCompanies';

const HOST = 'https://xn--80az8a.xn--d1aqf.xn--p1ai';

const DATA: IDomRfCompanies = {
  items: [
    {
      companyId: 42,
      name: 'Демо-Девелопмент',
      roles: ['customer', 'developer'],
      query: 'Демо-Девелопмент',
      foundBy: 'name',
      searchedAt: '2026-10-01T10:00:00Z',
      resultCount: 2,
      lastError: null,
      links: [
        {
          id: 7,
          kind: 'group',
          externalRef: '55',
          url: `${HOST}/группа/55`,
          name: 'ДЕМО-ГРУППА',
          details: 'Москва · объектов 12',
          foundBy: 'name',
          rank: 1,
          state: 'pending',
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
          hint: { verdict: 'match', reason: 'Совпадает название группы, объекты в Москве.', error: null, model: 'demo-model', at: '2026-10-02T10:00:00Z' },
        },
        {
          id: 8,
          kind: 'developer',
          externalRef: '901',
          url: `${HOST}/застройщик/901`,
          name: 'ООО СЗ ДЕМО',
          details: null,
          foundBy: 'name',
          rank: 2,
          state: 'pending',
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
          hint: { verdict: null, reason: null, error: 'schema_error: verdict', model: 'demo-model', at: '2026-10-02T10:00:00Z' },
        },
      ],
    },
  ],
  matched: 1,
  totals: { companies: 2801, searched: 1, withPending: 1, confirmed: 0, notFound: 0, several: 0 },
};

const as = (permissions: AccessPermission[], ui: ReactElement) => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: p => permissions.includes(p), user: { ...LOCAL_AUTH.user, permissions } }}>
    {ui}
  </AuthContext.Provider>
);

const OPERATOR: AccessPermission[] = ['portal.read', 'admin.view', 'sources.manage'];

// Текст сравнивается после нормализации пробелов: неразрывный разделитель тысяч — обычный пробел.
const NOTE = 'проверено 1 из 2 801, найдено 0';

describe('Компании на ДОМ.РФ', () => {
  it('ход поиска и найденное; «Это он» подтверждает, «Не он» отклоняет', async () => {
    const api = fakeApi([
      { match: 'GET /api/admin/domrf-companies', respond: () => ({ status: 200, body: DATA }) },
      { match: 'POST /api/admin/domrf-company-links/7/confirm', respond: () => ({ status: 200, body: { ok: true } }) },
      { match: 'POST /api/admin/domrf-company-links/8/reject', respond: () => ({ status: 200, body: { ok: true } }) },
    ]);
    renderWithProviders(as(OPERATOR, <DomRfCompanies />));

    expect(await screen.findByText(NOTE)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Демо-Девелопмент' }).getAttribute('href')).toBe('/company/42');
    expect(screen.getByText(/^заказчик, застройщик · по названию «Демо-Девелопмент»/)).not.toBeNull();
    // Рядом с найденным — строки выдачи и подсказка модели, подписанная как подсказка.
    expect(screen.getByText('Москва · объектов 12')).not.toBeNull();
    expect(screen.getByText('Модель: скорее он')).not.toBeNull();
    expect(screen.getByText(/Совпадает название группы/)).not.toBeNull();
    expect(screen.getByText('Подсказки модели нет: ответ пришёл не по форме.')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Это он — ДЕМО-ГРУППА' }));
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/admin/domrf-company-links/7/confirm')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Не он — ООО СЗ ДЕМО' }));
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/admin/domrf-company-links/8/reject')).toBe(true));
  });

  it('«Указать вручную» отправляет ссылку на страницу реестра; «Искать снова» ставит в очередь', async () => {
    const api = fakeApi([
      { match: 'GET /api/admin/domrf-companies', respond: () => ({ status: 200, body: DATA }) },
      { match: 'POST /api/admin/domrf-companies/42/link', respond: () => ({ status: 200, body: { ok: true } }) },
      { match: 'POST /api/admin/domrf-companies/42/search', respond: () => ({ status: 200, body: { ok: true } }) },
    ]);
    renderWithProviders(as(OPERATOR, <DomRfCompanies />));

    fireEvent.click(await screen.findByRole('button', { name: 'Указать вручную… — Демо-Девелопмент' }));
    const url = `${HOST}/сервисы/единый-реестр-застройщиков/застройщик/14929`;
    fireEvent.change(screen.getByLabelText('Страница застройщика или группы для «Демо-Девелопмент»'), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.calls.find(c => c.url === '/api/admin/domrf-companies/42/link')?.body).toEqual({ url }));

    fireEvent.click(screen.getByRole('button', { name: 'Искать снова — Демо-Девелопмент' }));
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/admin/domrf-companies/42/search')).toBe(true));
  });

  it('без права управлять источниками — найденное видно, решений нет', async () => {
    fakeApi([{ match: 'GET /api/admin/domrf-companies', respond: () => ({ status: 200, body: DATA }) }]);
    renderWithProviders(as(['portal.read', 'admin.view'], <DomRfCompanies />));

    expect(await screen.findByText(/ДЕМО-ГРУППА/)).not.toBeNull();
    expect(screen.getAllByText('предложено')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Это он/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Указать вручную/ })).toBeNull();
  });

  it('фильтр и поиск по названию уходят на сервер; список длиннее показанного — так и сказано', async () => {
    const api = fakeApi([
      {
        match: 'GET /api/admin/domrf-companies',
        respond: url => ({
          status: 200,
          body: url.includes('filter=all') ? { ...DATA, items: [{ ...DATA.items[0]!, roles: [], links: [], searchedAt: null }], matched: 2801 } : DATA,
        }),
      },
      { match: 'POST /api/admin/domrf-companies/42/search', respond: () => ({ status: 200, body: { ok: true } }) },
    ]);
    renderWithProviders(as(OPERATOR, <DomRfCompanies />));
    await screen.findByText(NOTE);

    fireEvent.click(screen.getByRole('button', { name: 'Все' }));
    expect(await screen.findByText('Показаны первые 1 из 2 801 — уточните поиском по названию.')).not.toBeNull();
    expect(screen.getByText('ещё не искали — в очереди')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Искать сейчас — Демо-Девелопмент' }));
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/admin/domrf-companies/42/search')).toBe(true));

    fireEvent.change(screen.getByLabelText('Компания по названию'), { target: { value: 'Демо' } });
    await waitFor(() => expect(api.calls.some(c => c.url === `/api/admin/domrf-companies?filter=all&q=${encodeURIComponent('Демо')}`)).toBe(true));
  });

  it('отмечено несколько: «Оставить только эту» и «Отменить» — с вопросом; закрытая выбором — «Отменить» без вопроса', async () => {
    const link = (id: number, name: string, state: 'confirmed' | 'rejected', decisionNote: string | null = null) => ({
      ...DATA.items[0]!.links[0]!,
      id,
      externalRef: String(id),
      name,
      state,
      decidedBy: 'leonsky',
      decidedAt: '2026-10-02T06:40:00Z',
      decisionNote,
      hint: null,
    });
    const several: IDomRfCompanies = {
      items: [{ ...DATA.items[0]!, name: 'Атлант', links: [link(1, 'ООО СЗ АТЛАНТ', 'confirmed'), link(2, 'ООО СЗ АТЛАНТ-ДВ', 'confirmed'), link(3, 'АТЛАНТ', 'rejected', 'выбрана другая запись')] }],
      matched: 1,
      totals: { ...DATA.totals, several: 1 },
    };
    const decision = { status: 200, body: { ok: true, closed: 1, reopened: 0, withdrawnObjects: 3 } };
    const api = fakeApi([
      { match: 'GET /api/admin/domrf-companies', respond: () => ({ status: 200, body: several }) },
      { match: 'POST /api/admin/domrf-company-links/1/confirm', respond: () => decision },
      { match: 'POST /api/admin/domrf-company-links/2/undo', respond: () => decision },
      { match: 'POST /api/admin/domrf-company-links/3/undo', respond: () => decision },
    ]);
    renderWithProviders(as(OPERATOR, <DomRfCompanies />), '/?filter=several');

    expect(await screen.findByText('выбрана другая запись')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Отмечено несколько: 1/ })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Оставить только эту — ООО СЗ АТЛАНТ' }));
    const keep = await screen.findByRole('dialog');
    expect(within(keep).getByText(/ООО СЗ АТЛАНТ-ДВ — станет «не он»/)).not.toBeNull();
    fireEvent.click(within(keep).getByRole('button', { name: 'Оставить только эту' }));
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/admin/domrf-company-links/1/confirm')).toBe(true));
    expect(await screen.findByText(/Другие записи компании — «не он»: 1; ушло из «Объектов»: 3\./)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Отменить — ООО СЗ АТЛАНТ-ДВ' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить отметку' }));
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/admin/domrf-company-links/2/undo')).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Отменить — АТЛАНТ' }));
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/admin/domrf-company-links/3/undo')).toBe(true));
  });
});
