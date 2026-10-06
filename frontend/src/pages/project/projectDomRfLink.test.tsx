// Карточка ДОМ.РФ со страницы объекта: ссылка уходит в очередь сбора с номером этого объекта; запись
// уже у другой карточки — отказ называет ту карточку и предлагает объединение, а не перепривязку;
// ссылка с ошибкой сбора — «Повторить»; читатель формы не видит.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { AccessPermission } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../../test/render';
import { ProjectDomRfLink } from './ProjectDomRfLink';

const as = (permissions: AccessPermission[], ui: ReactElement): ReactElement => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: p => permissions.includes(p), user: { ...LOCAL_AUTH.user, permissions } }}>
    {ui}
  </AuthContext.Provider>
);

const URL_62087 = 'https://xn--80az8a.xn--d1aqf.xn--p1ai/сервисы/каталог-новостроек/объект/62087';

const target = (over: Record<string, unknown> = {}) => ({
  id: 3,
  externalRef: '62087',
  url: URL_62087,
  capturedAt: null,
  status: 'pending',
  lastError: null,
  ...over,
});

const fillAndSubmit = (): void => {
  fireEvent.change(screen.getByLabelText('Ссылка на карточку объекта на наш.дом.рф'), { target: { value: URL_62087 } });
  fireEvent.click(screen.getByRole('button', { name: 'Привязать карточку' }));
};

describe('карточка ДОМ.РФ со страницы объекта', () => {
  it('ссылка уходит в сбор с номером объекта и видна как «Ждёт сбора»', async () => {
    let items: unknown[] = [];
    const api = fakeApi([
      { match: 'GET /api/admin/domrf-targets', respond: () => ({ status: 200, body: { items } }) },
      {
        match: 'POST /api/admin/domrf-targets',
        respond: () => {
          items = [target()];
          return { status: 200, body: { item: items[0] } };
        },
      },
    ]);
    renderWithProviders(<ProjectDomRfLink projectId={12} />);
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/admin/domrf-targets?projectId=12')).toBe(true));
    fillAndSubmit();
    expect(await screen.findByText('Ждёт сбора')).toBeTruthy();
    expect(api.calls.find(c => c.method === 'POST')?.body).toEqual({ url: URL_62087, projectId: 12 });
    expect(screen.getByRole('link', { name: /объект №62087/ }).getAttribute('href')).toBe(URL_62087);
  });

  it('запись уже у другого объекта — ссылка на него и «Сравнить и объединить»', async () => {
    fakeApi([
      { match: 'GET /api/admin/domrf-targets', respond: () => ({ status: 200, body: { items: [] } }) },
      {
        match: 'POST /api/admin/domrf-targets',
        respond: () => ({
          status: 409,
          body: { error: 'Эта карточка ДОМ.РФ уже у объекта портала «Адмирал» (№40)', code: 'linked_elsewhere', project: { id: 40, name: 'Адмирал' } },
        }),
      },
    ]);
    renderWithProviders(<ProjectDomRfLink projectId={12} />);
    fillAndSubmit();
    expect(await screen.findByText('Эта карточка ДОМ.РФ уже у другого объекта портала')).toBeTruthy();
    expect(screen.getByRole('link', { name: '«Адмирал»' }).getAttribute('href')).toBe('/projects/40');
    expect(screen.getByRole('button', { name: 'Сравнить и объединить' })).toBeTruthy();
  });

  it('ошибка сбора — «Повторить» ставит ссылку снова', async () => {
    const api = fakeApi([
      { match: 'GET /api/admin/domrf-targets', respond: () => ({ status: 200, body: { items: [target({ lastError: 'страница не открылась' })] } }) },
      { match: 'POST /api/admin/domrf-targets/3/rescan', respond: () => ({ status: 200, body: { ok: true } }) },
    ]);
    renderWithProviders(<ProjectDomRfLink projectId={12} />);
    expect(await screen.findByText('Ошибка сбора')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить №62087' }));
    await waitFor(() => expect(api.calls.some(c => c.method === 'POST' && c.url === '/api/admin/domrf-targets/3/rescan')).toBe(true));
  });

  it('читатель формы не видит и очередь не запрашивает', () => {
    const api = fakeApi([]);
    renderWithProviders(as(['portal.read'], <ProjectDomRfLink projectId={12} />));
    expect(screen.queryByRole('button', { name: 'Привязать карточку' })).toBeNull();
    expect(api.calls).toHaveLength(0);
  });
});
