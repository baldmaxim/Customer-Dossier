// Оболочка: «К содержанию», меню («Поиск» активен в обоих режимах главной), возврат только
// на детальных страницах и к родительскому списку без истории, фокус на h1 после перехода,
// объявление страницы для диктора.

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { FC, useEffect, useState } from 'react';
import { Link, useSearchParams, type RouteObject } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, LOCAL_AUTH } from '../hooks/useAuth';
import { renderWithRouter } from '../test/render';
import { Layout } from './Layout';
import { RouteError } from './RouteError';
import { PageHeader } from './ui/PageHeader';

const Home: FC = () => {
  const [params, setParams] = useSearchParams();
  return (
    <>
      <PageHeader title="Поиск" titleHidden />
      <p>режим: {params.get('view') ?? 'companies'}</p>
      <button type="button" onClick={() => setParams({ view: 'publications' })}>
        Публикации
      </button>
      <Link to="/company/7">ООО «Мост»</Link>
    </>
  );
};

const Company: FC = () => <PageHeader eyebrow="Компания" title="ООО «Мост»" />;

/** Страница, которая грузит данные: h1 появляется не сразу. */
const SlowProject: FC = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 30);
    return () => clearTimeout(timer);
  }, []);
  return ready ? <PageHeader title="ЖК «Северный»" /> : <p>Загрузка…</p>;
};

const routes = (): RouteObject[] => [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/company/:id', element: <Company /> },
      { path: '/projects/:id', element: <SlowProject /> },
      { path: '/documents/:id', element: <PageHeader title="Публикация" /> },
      { path: '/admin/process/:id', element: <PageHeader title="Разбор от 30.09.2026" /> },
      { path: '/news', element: <PageHeader title="Новое" /> },
    ],
  },
];

beforeEach(() => document.documentElement.setAttribute('data-theme', 'light'));

describe('оболочка', () => {
  it('«К содержанию» — первая ссылка страницы и переводит фокус в main', () => {
    renderWithRouter(routes());
    const skip = screen.getByRole('link', { name: 'К содержанию' });
    expect(document.querySelectorAll('a, button')[0]).toBe(skip);
    fireEvent.click(skip);
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('меню в шапке и нижняя панель — одни пункты; «Компании» — первый, «Новое» — второй (ADR-016, 24F)', () => {
    renderWithRouter(routes(), ['/?view=unidentified']);
    const header = screen.getByRole('navigation', { name: 'Основная навигация' });
    const tabbar = screen.getByRole('navigation', { name: 'Навигация' });
    for (const nav of [header, tabbar]) {
      expect(within(nav).getAllByRole('link').map(l => l.textContent)).toEqual(['Компании', 'Новое', 'Админка']);
      expect(within(nav).getByRole('link', { name: 'Компании' }).getAttribute('aria-current')).toBe('page');
    }
  });

  it('читатель вместо админки видит «Профиль»', () => {
    renderWithRouter([
      {
        element: (
          <AuthContext.Provider value={{ ...LOCAL_AUTH, can: p => p === 'portal.read' }}>
            <Layout />
          </AuthContext.Provider>
        ),
        children: [{ path: '/', element: <Home /> }],
      },
    ]);
    const header = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(header).queryByRole('link', { name: 'Админка' })).toBeNull();
    expect(within(header).getByRole('link', { name: 'Профиль' }).getAttribute('href')).toBe('/admin/account');
  });

  it('на разделах верхнего уровня возврата нет', () => {
    renderWithRouter(routes(), ['/news']);
    expect(screen.queryByRole('link', { name: /^К (компаниям|разборам)$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
  });

  it.each([
    ['/company/7', 'К компаниям', '/'],
    ['/projects/55', 'К компаниям', '/'],
    ['/documents/31', 'К компаниям', '/'],
    ['/admin/process/501', 'К разборам', '/admin/process'],
  ])('без истории %s ведёт к родительскому списку', (path, label, href) => {
    renderWithRouter(routes(), [path]);
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
  });

  it('с историей — «Назад» на шаг назад, туда же, откуда пришли', async () => {
    const { router } = renderWithRouter(routes(), ['/?q=мост']);
    fireEvent.click(screen.getByRole('link', { name: 'ООО «Мост»' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(decodeURIComponent(router.state.location.search)).toBe('?q=мост');
  });
});

describe('смена страницы', () => {
  it('фокус — на h1 новой страницы, диктор слышит её название, вкладка браузера — тоже', async () => {
    renderWithRouter(routes());
    fireEvent.click(screen.getByRole('link', { name: 'ООО «Мост»' }));
    const h1 = await screen.findByRole('heading', { level: 1, name: 'ООО «Мост»' });
    expect(document.activeElement).toBe(h1);
    expect(document.title).toBe('ООО «Мост» — Досье Заказчика');
    const region = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
    await waitFor(() => expect(region?.textContent).toBe('ООО «Мост»'));
  });

  it('смена только параметров адреса фокус не трогает', () => {
    renderWithRouter(routes());
    const button = screen.getByRole('button', { name: 'Публикации' });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByText('режим: publications')).toBeTruthy();
    expect(document.activeElement).toBe(button);
  });

  it('h1 ещё грузится — фокус на main, появился — переезжает на h1', async () => {
    const { router } = renderWithRouter(routes());
    await act(async () => {
      await router.navigate('/projects/55');
    });
    expect(document.activeElement).toBe(screen.getByRole('main'));
    const h1 = await screen.findByRole('heading', { level: 1, name: 'ЖК «Северный»' });
    await waitFor(() => expect(document.activeElement).toBe(h1));
  });
});

describe('сбой страницы', () => {
  it('ошибка отрисовки — внутри оболочки: меню на месте, «Обновить страницу» и «На главную»', () => {
    const Boom: FC = () => {
      throw new Error('сломалось');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithRouter([
      {
        element: <Layout />,
        children: [{ errorElement: <RouteError />, children: [{ path: '/', element: <Boom /> }] }],
      },
    ]);
    expect(screen.getByRole('heading', { level: 1, name: 'Страница не открылась' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('сломалось');
    expect(screen.getByRole('button', { name: 'Обновить страницу' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'На главную' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('navigation', { name: 'Основная навигация' })).toBeTruthy();
    spy.mockRestore();
  });
});
