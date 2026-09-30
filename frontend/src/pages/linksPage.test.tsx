// Экран «Связи»: заголовок называет центр, выбранное видно в поле, центр, вид и фильтры — в адресе,
// узел ведёт к связям соседа с теми же фильтрами, на телефоне по умолчанию — таблица.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IGraph } from '../api/types';
import { fakeApi, renderWithRouter } from '../test/render';
import { stubViewport } from '../test/viewport';
import { LinksPage } from './LinksPage';

const graph: IGraph = {
  nodes: [
    { key: 'c:1', kind: 'company', id: 1, label: 'Общество с ограниченной ответственностью «Бета-Демо»', subtype: 'legal_entity', details: [], depth: 0, seed: true },
    { key: 'c:2', kind: 'company', id: 2, label: 'Дельта-Демо', subtype: 'legal_entity', details: [], depth: 1, seed: false },
  ],
  edges: [
    {
      key: 'a:5',
      type: 'contract',
      from: 'c:1',
      to: 'c:2',
      assertionId: 5,
      role: 'subcontract',
      building: null,
      workPackage: null,
      validFrom: null,
      validTo: null,
      periodPrecision: 'unknown',
      status: 'text_grounded',
      polarity: 'positive',
      modality: 'reported_fact',
      supports: 1,
      contradicts: 0,
      contextProjectId: null,
      details: [],
    },
  ],
  truncated: false,
  notes: [],
};

const setup = (url: string) => {
  const api = fakeApi([
    {
      match: 'GET /api/graph',
      // Центр схемы — тот, что в запросе: у компании 8 своё имя узла-основы.
      respond: u => ({
        status: 200,
        body: u.includes('companyId=8') ? { ...graph, nodes: graph.nodes.map(n => (n.seed ? { ...n, id: 8, label: 'ООО «Мостострой-11»' } : n)) } : graph,
      }),
    },
    { match: 'GET /api/companies', respond: () => ({ status: 200, body: { items: [{ id: 8, name: 'ООО «Мостострой-11»', city: 'Сургут', legalForm: 'ООО', score: 1, identifiers: [] }] } }) },
    { match: 'GET /api/projects/search', respond: () => ({ status: 200, body: { items: [] } }) },
  ]);
  const view = renderWithRouter([{ path: '/links', element: <LinksPage /> }], [url]);
  return { api, ...view };
};

const graphCalls = (api: ReturnType<typeof fakeApi>): string[] => api.calls.filter(c => c.url.startsWith('/api/graph')).map(c => c.url);

describe('Связи', () => {
  it('без центра — «Связи компаний», пустое поле с меткой и подсказка, что делать', () => {
    setup('/links');
    expect(screen.getByRole('heading', { level: 1, name: 'Связи компаний' })).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Чьи связи показать' }) as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Выберите центр схемы')).toBeTruthy();
  });

  it('центр из адреса: заголовок «Связи: …» с короткой формой, центр виден в поле', async () => {
    setup('/links?company=1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Связи: ООО «Бета-Демо»' })).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Чьи связи показать' }) as HTMLInputElement).value).toBe('ООО «Бета-Демо»');
    expect(screen.getByRole('link', { name: /Карточка компании/ }).getAttribute('href')).toBe('/company/1');
  });

  it('вид и фильтры — из адреса и в адрес; «Назад» их не перебирает', async () => {
    const { api, router } = setup('/links?company=1&view=table&depth=3');
    expect(await screen.findByRole('table')).toBeTruthy();
    await waitFor(() => expect(graphCalls(api).some(u => u.includes('depth=3'))).toBe(true));
    expect((screen.getByLabelText('Шагов от центра') as HTMLSelectElement).value).toBe('3');

    fireEvent.click(screen.getByRole('checkbox', { name: 'совместное упоминание' }));
    await waitFor(() => expect(router.state.location.search).toContain('types=contract%2Cparticipation%2Ccorporate%2Chierarchy%2Cco_mentioned'));
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => expect(graphCalls(api).some(u => u.includes('co_mentioned'))).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Схема' }));
    await waitFor(() => expect(router.state.location.search).not.toContain('view='));
    expect(await screen.findByRole('group', { name: /^Схема связей/ })).toBeTruthy();
  });

  it('узел ведёт к связям соседа с теми же фильтрами', async () => {
    setup('/links?company=1&depth=3');
    const link = await screen.findByRole('link', { name: 'Дельта-Демо, компания · юрлицо: показать связи' });
    expect(link.getAttribute('href')).toBe('/links?company=2&depth=3');
  });

  it('выбор в поле — новый центр новой записью истории', async () => {
    const { router } = setup('/links?company=1');
    const field = screen.getByRole('combobox', { name: 'Чьи связи показать' });
    fireEvent.change(field, { target: { value: 'мост' } });
    await screen.findByRole('option', { name: /Мостострой-11/ });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(router.state.location.search).toBe('?company=8'));
    expect(router.state.historyAction).toBe('PUSH');
    // Новый центр — как новая страница: фокус на заголовке с его именем.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })));
    expect(document.activeElement?.textContent).toBe('Связи: ООО «Мостострой-11»');
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.search).toBe('?company=1');
  });

  it('на телефоне по умолчанию — связи списком фраз, а не схемой', async () => {
    stubViewport(360);
    setup('/links?company=1');
    const list = await screen.findByRole('list', { name: /^Связи: / });
    expect(within(list).getByText(/договор субподряда \(сообщён источником\)/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: /^Схема связей/ })).toBeNull();
  });
});
