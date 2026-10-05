// Схема связей на карточке: группа с именем вместо картинки, узлы и линии — цели с именами,
// id маркеров не пересекаются у двух схем, пояснения один раз, на телефоне — таблица.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { IGraph } from '../../api/types';
import { assertionResponse } from '../../test/assertionFixture';
import { fakeApi, renderWithProviders, type IFakeRoute } from '../../test/render';
import { stubViewport } from '../../test/viewport';
import { GraphPanel } from '../GraphPanel';

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

describe('GraphPanel', () => {
  it('схема — группа с именем; узлы — ссылки на карточки, линии — кнопки «откуда известно»', async () => {
    fakeApi(routes());
    const { container } = renderWithProviders(<GraphPanel companyId={1} defaultOpen />);

    const schema = await screen.findByRole('group', { name: /^Схема связей: Бета-Демо/ });
    expect(container.querySelector('[role="img"]')).toBeNull();
    const neighbour = within(schema).getByRole('link', { name: 'Дельта-Демо, компания · юрлицо: открыть карточку' });
    expect(neighbour.getAttribute('href')).toBe('/company/2');
    // Центр — не ссылка: он и есть текущая карточка.
    expect(within(schema).queryByRole('link', { name: /^Бета-Демо/ })).toBeNull();
    expect(within(schema).getByRole('button', { name: /^Бета-Демо — договор субподряда \(сообщён источником\) · корпус 3 — Дельта-Демо: откуда известно$/ })).toBeTruthy();
    // Машинные значения вида узла не печатаются.
    expect(container.textContent).not.toMatch(/legal_entity|complex/);
  });

  it('колесо мыши меняет масштаб схемы, а не прокручивает страницу; подсказка про мышь видна', async () => {
    fakeApi(routes());
    renderWithProviders(<GraphPanel companyId={1} defaultOpen />);
    const schema = await screen.findByRole('group', { name: /^Схема связей/ });
    const zoom = screen.getByRole('group', { name: 'Масштаб схемы' });
    const before = within(zoom).getByText(/%$/).textContent;
    const wheel = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true });
    schema.parentElement!.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    await waitFor(() => expect(within(zoom).getByText(/%$/).textContent).not.toBe(before));
    expect(screen.getByText('Колесо мыши — масштаб, левая кнопка — перетащить схему.')).toBeTruthy();
  });

  it('типы связей видны сразу и служат легендой, остальное — под «Ещё фильтры»', async () => {
    fakeApi(routes());
    renderWithProviders(<GraphPanel companyId={1} defaultOpen />);
    await screen.findByRole('group', { name: /^Схема связей/ });

    const legend = screen.getByRole('group', { name: 'Типы связей (легенда схемы)' });
    expect(within(legend).getByRole('checkbox', { name: 'договор (сообщён источником)' })).toBeTruthy();
    expect((within(legend).getByRole('checkbox', { name: 'совместное упоминание' }) as HTMLInputElement).checked).toBe(false);
    const more = screen.getByText('Ещё фильтры').closest('details');
    expect(more?.open).toBe(false);
  });

  it('у двух схем на одной странице — свои id маркеров, стрелки ссылаются на свои', async () => {
    fakeApi(routes());
    const { container } = renderWithProviders(
      <>
        <GraphPanel companyId={1} defaultOpen />
        <GraphPanel projectId={5} defaultOpen />
      </>,
    );
    await waitFor(() => expect(container.querySelectorAll('svg[role="group"]')).toHaveLength(2));
    const ids = [...container.querySelectorAll('marker')].map(m => m.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const svg of container.querySelectorAll('svg[role="group"]')) {
      const own = new Set([...svg.querySelectorAll('marker')].map(m => m.id));
      for (const path of svg.querySelectorAll('path[marker-end]')) {
        const ref = /url\(#(.+)\)/.exec(path.getAttribute('marker-end') ?? '')?.[1];
        expect(own.has(ref ?? '')).toBe(true);
      }
    }
  });

  it('линия открывает «Откуда известно»: цитата, источник-публикация и дата', async () => {
    fakeApi(routes());
    renderWithProviders(<GraphPanel companyId={1} defaultOpen />);
    const edge = await screen.findByRole('button', { name: /договор субподряда.*откуда известно$/ });
    fireEvent.click(edge);

    expect(edge.getAttribute('aria-expanded')).toBe('true');
    const panel = await screen.findByRole('region', { name: 'Откуда известно' });
    expect(await within(panel).findByText('Бета-Демо заключила договор субподряда с Дельта-Демо')).toBeTruthy();
    expect(within(panel).getAllByRole('link', { name: 'Стройка онлайн' })[0]?.getAttribute('href')).toBe('/documents/19');
    expect(within(panel).getByText(/подтверждают: 1\sцитата · опровергают: 1\sцитата/)).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Закрыть: откуда известно' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Откуда известно' })).toBeNull());
  });

  it('пояснения к схеме — один раз, граница обхода — словами', async () => {
    fakeApi(routes());
    renderWithProviders(<GraphPanel companyId={1} defaultOpen />);
    await screen.findByRole('group', { name: /^Схема связей/ });

    expect(screen.getAllByText(/промежуточные звенья не достраиваются/)).toHaveLength(1);
    expect(screen.getByText(/не дальше 2 шагов от центра/)).toBeTruthy();
    expect(screen.getByText('показаны не все')).toBeTruthy();
  });

  it('на телефоне по умолчанию — список связей фразами, схема — по выбору', async () => {
    stubViewport(360);
    fakeApi(routes());
    renderWithProviders(<GraphPanel companyId={1} defaultOpen />);

    const list = await screen.findByRole('list', { name: 'Связи: Бета-Демо' });
    expect(screen.queryByRole('group', { name: /^Схема связей/ })).toBeNull();
    // Связь с центром кликается целиком: ссылка — на второй её конец.
    // Скрытая часть имени — отдельным элементом: jsdom считает имя с пробелом перед двоеточием.
    expect(within(list).getByRole('link', { name: /^Дельта-Демо ?: открыть карточку$/ }).className).toContain('row-link-target');

    fireEvent.click(screen.getByRole('button', { name: 'Схема' }));
    expect(await screen.findByRole('group', { name: /^Схема связей/ })).toBeTruthy();
    // Масштаб — на широком экране; на телефоне схему листают пальцем.
    expect(screen.queryByRole('group', { name: 'Масштаб схемы' })).toBeNull();
  });

  it('свёрнутая панель не строит схему, пока её не раскрыли', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<GraphPanel companyId={1} />);

    const toggle = screen.getByRole('button', { name: 'Показать схему' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(api.calls.some(c => c.url.startsWith('/api/graph'))).toBe(false);
    fireEvent.click(toggle);
    expect(await screen.findByRole('group', { name: /^Схема связей/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Скрыть схему' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('прежний onRecenter: узел — кнопка, нажатие передаёт узел', async () => {
    fakeApi(routes());
    const onRecenter = vi.fn();
    renderWithProviders(<GraphPanel companyId={1} defaultOpen onRecenter={onRecenter} />);

    fireEvent.click(await screen.findByRole('button', { name: 'ЖК Демо, объект · комплекс: перестроить схему вокруг этого узла' }));
    expect(onRecenter).toHaveBeenCalledWith(expect.objectContaining({ key: 'p:5', kind: 'project', id: 5 }));
  });
});
