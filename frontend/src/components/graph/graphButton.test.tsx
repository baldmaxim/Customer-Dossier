// Схема связей окном с карточки: группа с именем вместо картинки, узлы и линии — цели с именами, нажатие на
// узел перестраивает схему в окне, id маркеров не пересекаются у двух схем, пояснения один раз, на телефоне —
// таблица; граф не грузится, пока окно не открыто.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { IGraph } from '../../api/types';
import { assertionResponse } from '../../test/assertionFixture';
import { fakeApi, renderWithProviders, type IFakeRoute } from '../../test/render';
import { stubViewport } from '../../test/viewport';
import { GraphButton } from './GraphButton';

const graph: IGraph = {
  nodes: [
    { key: 'c:1', kind: 'company', id: 1, label: 'Бета-Демо', subtype: 'legal_entity', details: [], depth: 0, seed: true },
    { key: 'c:2', kind: 'company', id: 2, label: 'Дельта-Демо', subtype: 'legal_entity', details: [], depth: 1, seed: false },
    { key: 'p:5', kind: 'project', id: 5, label: 'ЖК Демо', subtype: 'complex', details: [], depth: 1, seed: false },
  ],
  edges: [
    {
      key: 'a:5',
      type: 'contract',
      from: 'c:1',
      to: 'c:2',
      assertionId: 5,
      role: 'subcontract',
      building: 'корпус 3',
      workPackage: null,
      validFrom: '2024-03-01',
      validTo: null,
      periodPrecision: 'month',
      status: 'text_grounded',
      polarity: 'positive',
      modality: 'reported_fact',
      supports: 1,
      contradicts: 1,
      contextProjectId: null,
      details: [],
    },
    {
      key: 'a:6',
      type: 'participation',
      from: 'c:1',
      to: 'p:5',
      assertionId: 6,
      role: 'customer',
      building: null,
      workPackage: null,
      validFrom: null,
      validTo: null,
      periodPrecision: 'unknown',
      status: 'reviewed_supported',
      polarity: 'positive',
      modality: 'reported_fact',
      supports: 2,
      contradicts: 0,
      contextProjectId: null,
      details: [],
    },
  ],
  truncated: true,
  notes: ['Глубина ограничена 2: у крайних узлов могут быть другие связи.'],
};

const routes = (): IFakeRoute[] => [
  { match: 'GET /api/graph', respond: () => ({ status: 200, body: graph }) },
  { match: 'GET /api/assertions/5', respond: () => ({ status: 200, body: assertionResponse(5) }) },
];

/** Открыть окно схемы кнопкой «Схема связей». */
const openGraph = (name = 'Схема связей'): HTMLElement => {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.getByRole('dialog', { name: 'Схема связей' });
};

describe('GraphButton', () => {
  it('схема не грузится, пока окно не открыто', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<GraphButton companyId={1} />);

    expect(api.calls.some(c => c.url.startsWith('/api/graph'))).toBe(false);
    const dialog = openGraph();
    expect(await within(dialog).findByRole('group', { name: /^Схема связей: Бета-Демо/ })).toBeTruthy();
    expect(api.calls.some(c => c.url.startsWith('/api/graph?companyId=1'))).toBe(true);
  });

  it('схема — группа с именем; узлы — кнопки «перестроить», линии — кнопки «откуда известно»', async () => {
    fakeApi(routes());
    const { container } = renderWithProviders(<GraphButton companyId={1} />);
    const dialog = openGraph();

    const schema = await within(dialog).findByRole('group', { name: /^Схема связей: Бета-Демо/ });
    expect(container.ownerDocument.querySelector('[role="img"]')).toBeNull();
    expect(within(schema).getByRole('button', { name: 'Дельта-Демо, компания · юрлицо: перестроить схему вокруг этого узла' })).toBeTruthy();
    // Центр — не цель: схема и так вокруг него.
    expect(within(schema).queryByRole('button', { name: /^Бета-Демо, компания/ })).toBeNull();
    expect(within(schema).getByRole('button', { name: /^Бета-Демо — договор субподряда \(сообщён источником\) · корпус 3 — Дельта-Демо: откуда известно$/ })).toBeTruthy();
    // Машинные значения вида узла не печатаются.
    expect(dialog.textContent).not.toMatch(/legal_entity|complex/);
  });

  it('нажатие на узел перестраивает схему в окне; «Карточка объекта» и возврат к исходной', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<GraphButton companyId={1} />);
    const dialog = openGraph();

    fireEvent.click(await within(dialog).findByRole('button', { name: 'ЖК Демо, объект · комплекс: перестроить схему вокруг этого узла' }));
    await waitFor(() => expect(api.calls.some(c => c.url.startsWith('/api/graph?projectId=5'))).toBe(true));
    expect(within(dialog).getByRole('link', { name: 'Карточка объекта' }).getAttribute('href')).toBe('/projects/5');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Вернуть исходную схему' }));
    expect(within(dialog).queryByRole('link', { name: 'Карточка объекта' })).toBeNull();
  });

  it('переход по ссылке из окна закрывает его', async () => {
    fakeApi(routes());
    renderWithProviders(
      <Routes>
        <Route path="/company/:id" element={<GraphButton companyId={1} />} />
        <Route path="/projects/:id" element={<p>Страница объекта</p>} />
      </Routes>,
      '/company/1',
    );
    const dialog = openGraph();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'ЖК Демо, объект · комплекс: перестроить схему вокруг этого узла' }));
    fireEvent.click(await within(dialog).findByRole('link', { name: 'Карточка объекта' }));

    expect(await screen.findByText('Страница объекта')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Схема связей' })).toBeNull();
  });

  it('колесо мыши меняет масштаб схемы, а не прокручивает страницу; подсказка про мышь видна', async () => {
    fakeApi(routes());
    renderWithProviders(<GraphButton companyId={1} />);
    const dialog = openGraph();
    const schema = await within(dialog).findByRole('group', { name: /^Схема связей/ });
    const zoom = within(dialog).getByRole('group', { name: 'Масштаб схемы' });
    const before = within(zoom).getByText(/%$/).textContent;
    const wheel = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true });
    schema.parentElement!.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    await waitFor(() => expect(within(zoom).getByText(/%$/).textContent).not.toBe(before));
    expect(within(dialog).getByText('Колесо мыши — масштаб, левая кнопка — перетащить схему.')).toBeTruthy();
  });

  it('типы связей видны сразу и служат легендой, остальное — под «Ещё фильтры»', async () => {
    fakeApi(routes());
    renderWithProviders(<GraphButton companyId={1} />);
    const dialog = openGraph();
    await within(dialog).findByRole('group', { name: /^Схема связей/ });

    const legend = within(dialog).getByRole('group', { name: 'Типы связей (легенда схемы)' });
    expect(within(legend).getByRole('checkbox', { name: 'договор (сообщён источником)' })).toBeTruthy();
    expect((within(legend).getByRole('checkbox', { name: 'совместное упоминание' }) as HTMLInputElement).checked).toBe(false);
    const more = within(dialog).getByText('Ещё фильтры').closest('details');
    expect(more?.open).toBe(false);
  });

  it('у двух схем на одной странице — свои id маркеров, стрелки ссылаются на свои', async () => {
    fakeApi(routes());
    renderWithProviders(
      <>
        <GraphButton companyId={1} label="Схема компании" />
        <GraphButton projectId={5} label="Схема объекта" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Схема компании' }));
    fireEvent.click(screen.getByRole('button', { name: 'Схема объекта' }));
    await waitFor(() => expect(document.querySelectorAll('svg[role="group"]')).toHaveLength(2));
    const ids = [...document.querySelectorAll('marker')].map(m => m.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const svg of document.querySelectorAll('svg[role="group"]')) {
      const own = new Set([...svg.querySelectorAll('marker')].map(m => m.id));
      for (const path of svg.querySelectorAll('path[marker-end]')) {
        const ref = /url\(#(.+)\)/.exec(path.getAttribute('marker-end') ?? '')?.[1];
        expect(own.has(ref ?? '')).toBe(true);
      }
    }
  });

  it('линия открывает «Откуда известно»: цитата, источник-публикация и дата', async () => {
    fakeApi(routes());
    renderWithProviders(<GraphButton companyId={1} />);
    const dialog = openGraph();
    const edge = await within(dialog).findByRole('button', { name: /договор субподряда.*откуда известно$/ });
    fireEvent.click(edge);

    expect(edge.getAttribute('aria-expanded')).toBe('true');
    const panel = await within(dialog).findByRole('region', { name: 'Откуда известно' });
    expect(await within(panel).findByText('Бета-Демо заключила договор субподряда с Дельта-Демо')).toBeTruthy();
    expect(within(panel).getAllByRole('link', { name: 'Стройка онлайн' })[0]?.getAttribute('href')).toBe('/documents/19');
    expect(within(panel).getByText(/подтверждают: 1\sцитата · опровергают: 1\sцитата/)).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Закрыть: откуда известно' }));
    await waitFor(() => expect(within(dialog).queryByRole('region', { name: 'Откуда известно' })).toBeNull());
  });

  it('пояснения к схеме — один раз, граница обхода — словами', async () => {
    fakeApi(routes());
    renderWithProviders(<GraphButton companyId={1} />);
    const dialog = openGraph();
    await within(dialog).findByRole('group', { name: /^Схема связей/ });

    expect(within(dialog).getAllByText(/промежуточные звенья не достраиваются/)).toHaveLength(1);
    expect(within(dialog).getByText(/не дальше 2 шагов от центра/)).toBeTruthy();
    expect(within(dialog).getByText('показаны не все')).toBeTruthy();
  });

  it('на телефоне по умолчанию — список связей фразами, схема — по выбору', async () => {
    stubViewport(360);
    fakeApi(routes());
    renderWithProviders(<GraphButton companyId={1} />);
    const dialog = openGraph();

    const list = await within(dialog).findByRole('list', { name: 'Связи: Бета-Демо' });
    expect(within(dialog).queryByRole('group', { name: /^Схема связей/ })).toBeNull();
    expect(within(list).getByRole('button', { name: /^Дельта-Демо ?: перестроить схему вокруг этого узла$/ })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Схема' }));
    expect(await within(dialog).findByRole('group', { name: /^Схема связей/ })).toBeTruthy();
    // Масштаб — на широком экране; на телефоне схему листают пальцем.
    expect(within(dialog).queryByRole('group', { name: 'Масштаб схемы' })).toBeNull();
  });
});
