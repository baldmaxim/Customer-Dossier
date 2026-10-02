// Назначение имени без ИНН (ADR-016, этап 23D): кандидаты — компании портала (с вердиктом модели) и юрлица
// из Контур.Фокуса; «Это она» — слияние через предпросмотр и подтверждение, после него — карточка компании;
// «Это оно» и «Назначить» — реквизит на карточку, чужой реквизит открывает слияние с владельцем;
// «Это не компания» — с причиной, «Вернуть» снимает; читатель видит кандидатов без кнопок.

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { AccessPermission, IAssignmentView, ICompanyResponse, IMergeEntitySummary } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithRouter, type IFakeRoute } from '../../test/render';
import { CompanyUnidentified } from './CompanyUnidentified';

const data = {
  company: { id: 5, name: 'Демострой', legalForm: null, taxId: null, city: null, website: null, isVerified: false, mergedIntoId: null },
  aliases: [],
  identifiers: [],
} as ICompanyResponse;

const view = (over: Partial<IAssignmentView> = {}): IAssignmentView => ({
  state: 'unidentified',
  dismissal: null,
  portal: [
    { companyId: 9, name: 'Демострой', inn: '7707083893', ogrn: null, city: 'Москва', entityType: 'legal_entity', similarity: 1, mergeQueueId: 31, modelVerdict: 'same', modelReason: 'то же имя' },
  ],
  egrul: [
    { inn: '500100732259', ogrn: null, name: 'ООО "ДЕМОСТРОЙ ЮГ"', address: 'г Краснодар', status: 'Действующее', existingCompanyId: null, existingCompanyName: null },
  ],
  search: { query: 'Демострой', searchedAt: '2026-10-02T09:00:00Z', nextSearchAt: '2026-11-01T09:00:00Z', lastError: null },
  focusConfigured: true,
  ...over,
});

const entity = (id: number, name: string): IMergeEntitySummary => ({
  id, name, version: 1, mergedIntoId: null, city: null, legalForm: null, entityType: 'legal_entity', projectLevel: null, parentProjectId: null, identifiers: [], aliases: [],
});

const preview = (targetId: number) => ({
  kind: 'company', source: entity(5, 'Демострой'), target: entity(targetId, 'Демострой'), conflicts: [], warnings: [], counts: { mentions: 2 },
  reviewedAssertions: [], canApply: true, previewToken: 'f'.repeat(64),
});

const as = (permissions: AccessPermission[], ui: ReactElement): ReactElement => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: p => permissions.includes(p), user: { ...LOCAL_AUTH.user, permissions } }}>
    {ui}
  </AuthContext.Provider>
);

const render = (routes: IFakeRoute[], ui: ReactElement = <CompanyUnidentified companyId={5} data={data} />) => {
  const api = fakeApi(routes);
  const view = renderWithRouter([
    { path: '/company/5', element: ui },
    { path: '/company/:id', element: <p>Карточка компании</p> },
  ], ['/company/5']);
  return { api, ...view };
};

const assignment = (body: IAssignmentView = view()): IFakeRoute => ({ match: 'GET /api/companies/5/assignment', respond: () => ({ status: 200, body }) });

describe('назначение имени без ИНН', () => {
  it('«Это она»: сравнение, подтверждение, слияние — и переход в карточку компании', async () => {
    const { api, router } = render([
      assignment(),
      { match: 'GET /api/entities/merge-preview', respond: () => ({ status: 200, body: preview(9) }) },
      { match: 'POST /api/entities/merge', respond: () => ({ status: 201, body: { mergeId: 1, replayed: false } }) },
    ]);
    const portal = (await screen.findByRole('heading', { name: 'Похожие компании портала' })).closest('section')!;
    expect(within(portal).getByText('ИНН 7707083893 · Москва · в «Возможных дублях»')).toBeTruthy();
    expect(within(portal).getByText('модель: скорее та же компания — то же имя')).toBeTruthy();

    fireEvent.click(within(portal).getByRole('button', { name: 'Это она' }));
    fireEvent.click(await within(portal).findByRole('button', { name: 'Объединить' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Объединить' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/company/9'));
    expect(api.calls.find(c => c.method === 'POST')?.body).toMatchObject({ kind: 'company', sourceId: 5, targetId: 9, expectedPreviewToken: 'f'.repeat(64) });
    expect(api.calls.some(c => c.url === '/api/entities/merge-preview?kind=company&sourceId=5&targetId=9')).toBe(true);
  });

  it('«Это оно»: реквизит юрлица из Фокуса назначается карточке', async () => {
    const { api } = render([
      assignment(),
      { match: 'POST /api/companies/5/identify', respond: () => ({ status: 200, body: { identifier: { type: 'inn', value: '500100732259' }, focus: { status: 'found' } } }) },
    ]);
    const egrul = (await screen.findByRole('heading', { name: 'Юрлица по названию — Контур.Фокус' })).closest('section')!;
    expect(within(egrul).getByText('ИНН 500100732259 · Действующее · г Краснодар')).toBeTruthy();
    expect(within(egrul).getByText('Искали 02.10.2026 по «Демострой».')).toBeTruthy();
    fireEvent.click(within(egrul).getByRole('button', { name: 'Это оно' }));
    expect(await screen.findByText(/Реквизит назначен — теперь это юрлицо\. Сведения ЕГРЮЛ получены/)).toBeTruthy();
    expect(api.calls.find(c => c.method === 'POST')?.body).toEqual({ identifier: '500100732259' });
  });

  it('реквизит уже у другой компании — сказано у какой, открывается слияние с ней', async () => {
    render([
      assignment(view({ portal: [] })),
      {
        match: 'POST /api/companies/5/identify',
        respond: () => ({ status: 409, body: { error: 'уже у компании', code: 'identifier_taken', companyId: 12, companyName: 'ООО Демо' } }),
      },
      { match: 'GET /api/entities/merge-preview', respond: () => ({ status: 200, body: preview(12) }) },
    ]);
    fireEvent.change(await screen.findByLabelText('ИНН или ОГРН юрлица'), { target: { value: '7707083893' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));
    expect(await screen.findByText('Этот реквизит уже у компании «ООО Демо»')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Объединить' })).toBeTruthy();
  });

  it('опечатка в ручном реквизите — подсказка до запроса', async () => {
    const { api } = render([assignment()]);
    fireEvent.change(await screen.findByLabelText('ИНН или ОГРН юрлица'), { target: { value: '7707083894' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));
    expect(await screen.findByText('Контрольная сумма не сходится — проверьте цифры')).toBeTruthy();
    expect(api.calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('«Это не компания» — с причиной; отмеченное можно вернуть', async () => {
    const dismissed = view({ state: 'dismissed', dismissal: { reason: 'фамилия журналиста', by: 'operator', at: '2026-10-02T10:00:00Z' } });
    const { api } = render([
      assignment(),
      { match: 'PUT /api/companies/5/dismissal', respond: () => ({ status: 200, body: { view: dismissed } }) },
      { match: 'DELETE /api/companies/5/dismissal', respond: () => ({ status: 200, body: { view: view() } }) },
    ]);
    fireEvent.click((await screen.findByText('Это не компания')).closest('summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Отметить: не компания' }));
    expect(await screen.findByText('Напишите, почему это не компания')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Почему'), { target: { value: 'фамилия журналиста' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отметить: не компания' }));
    expect(await screen.findByText('Отмечено: не компания')).toBeTruthy();
    expect(api.calls.find(c => c.method === 'PUT')?.body).toEqual({ reason: 'фамилия журналиста' });
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в «Без ИНН»' }));
    expect(await screen.findByText('Имя вернулось в «Без ИНН».')).toBeTruthy();
  });

  it('«Искать в Контур.Фокусе» — запрос и итог словами; без ключа — кнопки нет', async () => {
    render([
      assignment(),
      { match: 'POST /api/companies/5/name-search', respond: () => ({ status: 200, body: { result: { status: 'searched', found: 1 }, view: view() } }) },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Искать в Контур.Фокусе' }));
    expect(await screen.findByText('Подсказок Контур.Фокуса: 1.')).toBeTruthy();
  });

  it('читатель видит кандидатов, но не кнопки решений', async () => {
    render([assignment(view({ focusConfigured: false, search: null }))], as(['portal.read'], <CompanyUnidentified companyId={5} data={data} />));
    expect(await screen.findByText('ООО "ДЕМОСТРОЙ ЮГ"')).toBeTruthy();
    expect(screen.getByText('Контур.Фокус не подключён — подсказок по названию нет.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Это она' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Это оно' })).toBeNull();
    expect(screen.queryByText('Указать ИНН вручную')).toBeNull();
    expect(screen.queryByText('Это не компания')).toBeNull();
  });
});
