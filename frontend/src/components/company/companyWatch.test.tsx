// Компания по реквизиту и «На контроле» (ADR-016): в поиске набран ИНН, а карточки нет — экран
// предлагает завести компанию и ведёт в неё; опечатка в реквизите — предупреждение, без кнопки;
// читатель без права видит только пояснение. «На контроле» переключается кнопкой с aria-pressed.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { AccessPermission } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { identifierOfQuery } from '../../lib/taxId';
import { fakeApi, renderWithProviders, renderWithRouter } from '../../test/render';
import { EntityResults } from '../search/EntityResults';
import { WatchToggle } from './WatchToggle';

const as = (permissions: AccessPermission[], ui: ReactElement): ReactElement => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: p => permissions.includes(p), user: { ...LOCAL_AUTH.user, permissions } }}>
    {ui}
  </AuthContext.Provider>
);

const emptySearch = [
  { match: 'GET /api/companies', respond: () => ({ status: 200, body: { items: [] } }) },
  { match: 'GET /api/projects/search', respond: () => ({ status: 200, body: { items: [] } }) },
];

describe('реквизит в строке поиска', () => {
  it('identifierOfQuery: ИНН, ОГРН, ОГРНИП и контрольная сумма', () => {
    expect(identifierOfQuery('7707 083 893')).toEqual({ type: 'inn', value: '7707083893', label: 'ИНН 7707083893', checksumOk: true });
    expect(identifierOfQuery('1027700132195')).toMatchObject({ type: 'ogrn', checksumOk: true });
    expect(identifierOfQuery('7707083894')).toMatchObject({ checksumOk: false });
    expect(identifierOfQuery('Ромашка')).toBeNull();
    expect(identifierOfQuery('12345')).toBeNull();
  });

  it('ИНН не найден — «Добавить компанию» заводит её и открывает карточку', async () => {
    const api = fakeApi([
      ...emptySearch,
      {
        match: 'POST /api/companies',
        respond: () => ({ status: 201, body: { companyId: 77, created: true, identifier: { type: 'inn', value: '7707083893' }, focus: { status: 'stopped', reason: 'no_key' } } }),
      },
    ]);
    const { router } = renderWithRouter([
      { path: '/', element: <EntityResults query="7707083893" onClear={() => undefined} /> },
      { path: '/company/:id', element: <p>Карточка</p> },
    ]);
    expect(await screen.findByText('В портале нет компании с ИНН 7707083893')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить компанию' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/company/77'));
    expect(api.calls.find(c => c.method === 'POST')?.body).toEqual({ identifier: '7707083893' });
    expect(await screen.findByText(/Компания заведена и поставлена на контроль\. Контур\.Фокус не подключён/)).toBeTruthy();
  });

  it('карточка с этим ИНН нашлась — предложения завести нет', async () => {
    fakeApi([
      { match: 'GET /api/companies', respond: () => ({ status: 200, body: { items: [{ id: 5, name: 'Сбербанк', city: null, legalForm: 'ПАО', score: 1, identifiers: ['inn 7707083893'] }] } }) },
      { match: 'GET /api/projects/search', respond: () => ({ status: 200, body: { items: [] } }) },
    ]);
    renderWithProviders(<EntityResults query="7707083893" onClear={() => undefined} />);
    expect(await screen.findByText('Сбербанк')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить компанию' })).toBeNull();
  });

  it('опечатка — предупреждение без кнопки; читатель — пояснение без кнопки', async () => {
    fakeApi(emptySearch);
    const typo = renderWithProviders(<EntityResults query="7707083894" onClear={() => undefined} />);
    expect(await screen.findByText('ИНН 7707083894: контрольная сумма не сходится')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить компанию' })).toBeNull();
    typo.unmount();

    renderWithProviders(as(['portal.read'], <EntityResults query="7707083893" onClear={() => undefined} />));
    expect(await screen.findByText('Завести компанию по реквизиту может оператор.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить компанию' })).toBeNull();
  });
});

describe('«На контроле»', () => {
  it('кнопка с aria-pressed ставит и снимает отметку', async () => {
    const api = fakeApi([
      { match: 'PUT /api/companies/9/watch', respond: () => ({ status: 200, body: { watch: { addedBy: 'operator', addedAt: '2026-10-02T10:00:00Z' } } }) },
    ]);
    renderWithProviders(<WatchToggle companyId={9} watch={null} />);
    const button = screen.getByRole('button', { name: 'На контроле' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(await screen.findByText('Компания на контроле.')).toBeTruthy();
    expect(api.calls.map(c => `${c.method} ${c.url}`)).toEqual(['PUT /api/companies/9/watch']);
  });

  it('читатель видит подпись, а не кнопку', () => {
    renderWithProviders(as(['portal.read'], <WatchToggle companyId={9} watch={{ addedBy: 'operator', addedAt: '2026-10-02T10:00:00Z' }} />));
    expect(screen.getByText('На контроле')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
