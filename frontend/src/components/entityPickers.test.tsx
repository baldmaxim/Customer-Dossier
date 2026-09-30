// Поле выбора компании или объекта: метка (а не только placeholder), выбранное видно в поле,
// найденное — группами с реквизитами, выбор с клавиатуры, пусто — словами.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fakeApi, renderWithProviders } from '../test/render';
import { CompanyPicker, EntityPicker } from './EntityPickers';

const companies = [
  { id: 8, name: 'ООО «Мостострой-11»', city: 'Сургут', legalForm: 'ООО', score: 0.97, entityType: 'legal_entity', identifiers: ['inn 8602000000'], projects: 23, matchedAlias: null, homonyms: 0 },
  { id: 61, name: 'Мостострой', city: 'Казань', legalForm: null, score: 0.61, entityType: 'brand', identifiers: [], projects: 0, matchedAlias: null, homonyms: 3 },
];
const projects = [
  { id: 58, name: 'Мост через Оку', city: 'Нижний Новгород', kind: 'infrastructure', level: 'complex', levelLabel: null, parentId: null, parentName: null, children: 0 },
];

const search = (withProjects = true) =>
  fakeApi([
    { match: 'GET /api/companies', respond: () => ({ status: 200, body: { items: companies } }) },
    { match: 'GET /api/projects/search', respond: () => ({ status: 200, body: { items: withProjects ? projects : [] } }) },
  ]);

describe('EntityPicker', () => {
  it('подписано меткой с подсказкой, выбранное видно в самом поле', () => {
    search();
    renderWithProviders(<EntityPicker label="Чьи связи показать" value={{ kind: 'company', id: 7, name: 'ООО «Ромашка»' }} onSelect={vi.fn()} />);
    const field = screen.getByRole('combobox', { name: 'Чьи связи показать' }) as HTMLInputElement;
    expect(field.value).toBe('ООО «Ромашка»');
    expect(field.getAttribute('aria-expanded')).toBe('false');
    const hint = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Название, ИНН или ОГРН');
  });

  it('найденное — группами «Компании» и «Объекты», с реквизитами словами; стрелка и Enter выбирают', async () => {
    search();
    const onSelect = vi.fn();
    renderWithProviders(<EntityPicker label="Чьи связи показать" value={null} onSelect={onSelect} />);
    const field = screen.getByRole('combobox', { name: 'Чьи связи показать' });
    fireEvent.change(field, { target: { value: 'мост' } });

    const list = await screen.findByRole('listbox');
    await within(list).findByRole('option', { name: /Мост через Оку/ });
    expect(within(list).getByRole('group', { name: 'Компании' })).toBeTruthy();
    expect(within(list).getByRole('group', { name: 'Объекты' })).toBeTruthy();
    expect(within(list).getByText(/ИНН 8602000000/)).toBeTruthy();
    expect(within(list).getByText(/одноимённых: 3 — сверьте ИНН/)).toBeTruthy();
    expect(list.textContent).not.toMatch(/inn |#\d|в выборке/);

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(field.getAttribute('aria-activedescendant')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({ kind: 'company', id: 8, name: 'ООО «Мостострой-11»' });
  });

  it('ничего не нашлось — словами в своей группе', async () => {
    search(false);
    renderWithProviders(<EntityPicker label="Чьи связи показать" value={null} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Чьи связи показать' }), { target: { value: 'мост' } });
    expect(await screen.findByText('Объект не найден.')).toBeTruthy();
  });

  it('Esc закрывает список и возвращает выбранное в поле', async () => {
    search();
    renderWithProviders(<EntityPicker label="Чьи связи показать" value={{ kind: 'project', id: 55, name: 'ЖК «Северная долина»' }} onSelect={vi.fn()} />);
    const field = screen.getByRole('combobox', { name: 'Чьи связи показать' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'мост' } });
    await screen.findByRole('option', { name: /Мост через Оку/ });

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(field.value).toBe('ЖК «Северная долина»'));
  });
});

describe('CompanyPicker (прежние пропсы)', () => {
  it('крестик снимает выбор: onSelect(null)', () => {
    search();
    const onSelect = vi.fn();
    renderWithProviders(<CompanyPicker label="Компания" selected={{ id: 7, name: 'ООО «Ромашка»' }} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
