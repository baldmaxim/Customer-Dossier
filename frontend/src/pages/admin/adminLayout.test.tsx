// Админка: разделы «Источники · Обработка · Проверка │ Модель · Пользователи │ Профиль» по правам,
// один h1 на раздел и строка состояния обработки словами. Профиль — раздел админки, читателю
// доступен только он.
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { AccessPermission } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../../test/render';
import { AccountPage } from '../AccountPage';
import { AdminLayout } from './AdminLayout';

const PIPELINE = {
  revisions: [],
  failures: [],
  model: { ok: false, error: 'LM Studio не отвечает', models: [] },
  worker: { ingestEnabled: true, pipelineEnabled: true, autoPublish: false, metricsAutoRefresh: false, retryEnabled: true, retryMax: 3 },
};

const ADMIN: AccessPermission[] = ['portal.read', 'admin.view', 'users.manage', 'llm.manage'];
const OPERATOR: AccessPermission[] = ['portal.read', 'admin.view', 'sources.manage', 'review.decide', 'entities.merge'];

const renderAs = (permissions: AccessPermission[], route: string) => {
  fakeApi([{ match: 'GET /api/admin/pipeline', respond: () => ({ status: 200, body: PIPELINE }) }]);
  return renderWithProviders(
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
          <Route path="sources" element={<p>источники</p>} />
          <Route path="process/:id" element={<h1>Разбор от 30.09.26, 11:00</h1>} />
          <Route path="account" element={<AccountPage />} />
        </Route>
      </Routes>
    </AuthContext.Provider>,
    route,
  );
};

const sectionLinks = (): string[] =>
  within(screen.getByRole('navigation', { name: 'Разделы админки' }))
    .getAllByRole('link')
    .map(link => link.textContent ?? '');

describe('админка: разделы и профиль', () => {
  it('администратор видит все шесть разделов; профиль озаглавлен «Профиль», а не «Админка»', () => {
    renderAs(ADMIN, '/admin/account');

    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['Профиль']);
    expect(sectionLinks()).toEqual(['Источники', 'Обработка', 'Проверка', 'Модель', 'Пользователи', 'Профиль']);
    const nav = within(screen.getByRole('navigation', { name: 'Разделы админки' }));
    expect(nav.getByRole('link', { name: 'Источники' }).getAttribute('href')).toBe('/admin/sources');
    expect(nav.getByRole('link', { name: 'Модель' }).getAttribute('href')).toBe('/admin/model');
    expect(nav.getByRole('link', { name: 'Профиль' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('ivanov')).not.toBeNull();
    // Прежней навигации «Конвейер» и абзаца про ступени больше нет.
    expect(screen.queryByRole('navigation', { name: 'Конвейер' })).toBeNull();
    expect(screen.queryByText(/Портал сам собирает тексты/)).toBeNull();
  });

  it('оператор: разделы без «Пользователей», модель — для просмотра', () => {
    renderAs(OPERATOR, '/admin/sources');

    expect(sectionLinks()).toEqual(['Источники', 'Обработка', 'Проверка', 'Модель', 'Профиль']);
    expect(screen.getByRole('heading', { level: 1, name: 'Источники' })).not.toBeNull();
  });

  it('читатель попадает из админки в свой профиль: ни разделов, ни строки состояния', () => {
    renderAs(['portal.read'], '/admin/sources');

    expect(screen.getByRole('heading', { level: 1, name: 'Профиль' })).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Разделы админки' })).toBeNull();
    expect(screen.queryByText('источники')).toBeNull();
    expect(screen.queryByText(/Сбор идёт/)).toBeNull();
    expect(screen.getByText('ivanov')).not.toBeNull();
  });

  it('строка состояния — словами; имена переменных окружения — только в пояснении администратору', async () => {
    const admin = renderAs(ADMIN, '/admin/sources');
    expect(await screen.findByText('Сбор идёт')).not.toBeNull();
    expect(screen.getByText('Разбор ждёт модель')).not.toBeNull();
    expect(screen.getByText('Перенос в карточки выключен')).not.toBeNull();
    expect(screen.getByText('Модель не отвечает')).not.toBeNull();
    const hint = screen.getByRole('button', { name: /Пояснение: состояние обработки/ });
    expect(hint.getAttribute('aria-description')).toMatch(/INGEST_ENABLED=true/);
    expect(hint.getAttribute('aria-description')).toMatch(/LM Studio не отвечает/);
    admin.unmount();

    renderAs(OPERATOR, '/admin/sources');
    const operatorHint = await screen.findByRole('button', { name: /Пояснение: состояние обработки/ });
    expect(operatorHint.getAttribute('aria-description')).not.toMatch(/_ENABLED|\.env/);
    expect(operatorHint.getAttribute('aria-description')).toMatch(/в настройках сервера/);
  });

  it('разбор — отдельная страница со своим заголовком: вкладок и второго h1 над ним нет', () => {
    renderAs(ADMIN, '/admin/process/501');

    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['Разбор от 30.09.26, 11:00']);
    expect(screen.queryByRole('navigation', { name: 'Разделы админки' })).toBeNull();
  });
});
