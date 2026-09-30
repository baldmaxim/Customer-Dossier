// Админка и профиль — одно место: профиль — вкладка админки, читателю доступна только она.
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { AccessPermission } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { renderWithProviders } from '../../test/render';
import { AccountPage } from '../AccountPage';
import { AdminLayout } from './AdminLayout';

const renderAs = (permissions: AccessPermission[], route: string) =>
  renderWithProviders(
    <AuthContext.Provider
      value={{
        ...LOCAL_AUTH,
        authRequired: true,
        can: p => permissions.includes(p),
        user: { ...LOCAL_AUTH.user, login: 'ivanov', displayName: 'Иван Иванов', permissions },
      }}
    >
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<p>ступени конвейера</p>} />
          <Route path="account" element={<AccountPage />} />
        </Route>
      </Routes>
    </AuthContext.Provider>,
    route,
  );

describe('админка и профиль', () => {
  it('у администратора профиль — вкладка рядом с моделью и пользователями, без пояснения про конвейер', () => {
    renderAs(['portal.read', 'admin.view', 'users.manage', 'llm.manage'], '/admin/account');

    expect(screen.getByRole('heading', { level: 1, name: 'Админка' })).not.toBeNull();
    const tabs = within(screen.getByRole('navigation', { name: 'Конвейер' }));
    expect(tabs.getByRole('link', { name: 'Модель' }).getAttribute('href')).toBe('/admin/model');
    expect(tabs.getByRole('link', { name: 'Пользователи' })).not.toBeNull();
    expect(tabs.getByRole('link', { name: 'Профиль' }).getAttribute('href')).toBe('/admin/account');
    expect(screen.getByText('ivanov')).not.toBeNull();
    expect(screen.queryByText(/Портал сам собирает тексты/)).toBeNull();
  });

  it('читатель попадает из админки в свой профиль: ни ступеней, ни чужих вкладок', () => {
    renderAs(['portal.read'], '/admin');

    expect(screen.getByRole('heading', { level: 1, name: 'Профиль' })).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Конвейер' })).toBeNull();
    expect(screen.queryByText('ступени конвейера')).toBeNull();
    expect(screen.getByText('ivanov')).not.toBeNull();
  });
});
