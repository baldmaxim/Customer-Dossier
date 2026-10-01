// «Найдено на ДОМ.РФ» (этап 20D): найденное сгруппировано по застройщику, компания портала — по ИНН;
// подтвердить, подтвердить пачкой, заменить правильной ссылкой; без права sources.manage решений нет.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { AccessPermission, IDomRfCandidate, IDomRfCandidates } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../../test/render';
import { DomRfCandidates } from './DomRfCandidates';

const candidate = (id: number, ref: string, label: string): IDomRfCandidate => ({
  id,
  externalRef: ref,
  url: `https://xn--80az8a.xn--d1aqf.xn--p1ai/сервисы/каталог-новостроек/объект/${ref}`,
  label,
  details: 'Строится · г. Москва, Район Демо',
  foundViaKind: 'group',
  foundViaRef: '55',
  state: 'pending',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  replacementRef: null,
  firstSeenAt: '2026-10-01T10:00:00Z',
});

const PENDING: IDomRfCandidates = {
  items: [candidate(1, '7001', 'Демо-квартал'), candidate(2, '7002', 'Демо-парк')],
  sources: [
    {
      kind: 'group',
      externalRef: '55',
      url: 'https://xn--80az8a.xn--d1aqf.xn--p1ai/сервисы/единый-реестр-застройщиков/группа-компаний/55',
      name: 'ДЕМО-ГРУППА',
      inn: '7700001235',
      scannedAt: '2026-10-01T10:00:00Z',
      companyId: 42,
      companyName: 'Демо-Группа',
      pending: 2,
    },
  ],
};

const as = (permissions: AccessPermission[], ui: ReactElement) => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: p => permissions.includes(p), user: { ...LOCAL_AUTH.user, permissions } }}>
    {ui}
  </AuthContext.Provider>
);

const OPERATOR: AccessPermission[] = ['portal.read', 'admin.view', 'sources.manage'];

describe('Найдено на ДОМ.РФ', () => {
  it('группа с компанией портала по ИНН; «Подтвердить» ставит объект в сбор', async () => {
    const api = fakeApi([
      { match: 'GET /api/admin/domrf-candidates', respond: () => ({ status: 200, body: PENDING }) },
      { match: 'POST /api/admin/domrf-candidates/1/confirm', respond: () => ({ status: 200, body: { ok: true } }) },
    ]);
    renderWithProviders(as(OPERATOR, <DomRfCandidates />));

    expect(await screen.findByText('Группа компаний ДЕМО-ГРУППА')).not.toBeNull();
    expect(screen.getByText('ИНН 7700001235')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Компания в портале: Демо-Группа' }).getAttribute('href')).toBe('/company/42');
    expect(screen.getByText('ждут решения: 2')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить №7001' }));
    await waitFor(() => expect(api.calls.some(c => c.method === 'POST' && c.url === '/api/admin/domrf-candidates/1/confirm')).toBe(true));
  });

  it('выбор флажками и «Выбрать все» — подтверждение пачкой одним запросом', async () => {
    const api = fakeApi([
      { match: 'GET /api/admin/domrf-candidates', respond: () => ({ status: 200, body: PENDING }) },
      { match: 'POST /api/admin/domrf-candidates/confirm', respond: () => ({ status: 200, body: { confirmed: 2, failed: [] } }) },
    ]);
    renderWithProviders(as(OPERATOR, <DomRfCandidates />));

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить выбранные: 2' }));
    await waitFor(() =>
      expect(api.calls.find(c => c.url === '/api/admin/domrf-candidates/confirm')?.body).toEqual({ ids: [1, 2] }),
    );
  });

  it('«Заменить» отправляет правильную ссылку вместо найденной', async () => {
    const api = fakeApi([
      { match: 'GET /api/admin/domrf-candidates', respond: () => ({ status: 200, body: PENDING }) },
      { match: 'POST /api/admin/domrf-candidates/2/replace', respond: () => ({ status: 200, body: { ok: true } }) },
    ]);
    renderWithProviders(as(OPERATOR, <DomRfCandidates />));

    fireEvent.click(await screen.findByRole('button', { name: 'Заменить… №7002' }));
    const url = 'https://xn--80az8a.xn--d1aqf.xn--p1ai/сервисы/каталог-новостроек/объект/8001';
    fireEvent.change(screen.getByLabelText('Правильная карточка вместо №7002'), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: 'Заменить' }));
    await waitFor(() => expect(api.calls.find(c => c.url === '/api/admin/domrf-candidates/2/replace')?.body).toEqual({ url }));
  });

  it('без права управлять источниками — только список, без кнопок решений', async () => {
    fakeApi([{ match: 'GET /api/admin/domrf-candidates', respond: () => ({ status: 200, body: PENDING }) }]);
    renderWithProviders(as(['portal.read', 'admin.view'], <DomRfCandidates />));

    const list = await screen.findByRole('list', { name: 'Группа компаний ДЕМО-ГРУППА' });
    expect(within(list).getAllByText('ждёт решения')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Подтвердить/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
