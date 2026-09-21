// Панель реестра (этап 20B): дата сведений, атрибуция и изменения между снимками.
// Данные синтетические; сеть и сервер не участвуют.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IRegistryView } from '../api/types';
import { renderWithProviders } from '../test/render';
import { RegistryPanel } from './RegistryPanel';

const view = (over: Partial<IRegistryView> = {}): IRegistryView => ({
  source: { key: 'registry-demo.test', title: 'Демо-реестр' },
  externalRef: '62087',
  asOf: '2026-09-21',
  fetchedAt: '2026-09-21T10:00:00.000Z',
  fields: [
    { label: 'Срок сдачи', value: '30.09.2028' },
    { label: 'Количество этажей', value: '26' },
  ],
  developer: { name: 'СЗ ДЕМО-ПРАКТИКА', legalForm: 'ООО', inn: '7704412966', ogrn: null },
  groupName: 'Демо-Строй',
  address: 'Москва город, Район Замоскворечье',
  changes: [],
  coverage: { loaded: 1, truncated: false },
  attribution: 'Сведения реестра на указанную дату. Это проектная декларация застройщика, а не проверенный факт.',
  ...over,
});

describe('панель реестра', () => {
  it('ничего не рисует, если объекта в реестре нет', () => {
    const { container } = renderWithProviders(<RegistryPanel registry={null} />);
    expect(container.textContent).toBe('');
  });

  it('показывает поля, застройщика с ИНН и атрибуцию — без слова «проверено»', () => {
    renderWithProviders(<RegistryPanel registry={view()} />);
    expect(screen.getByText('ООО СЗ ДЕМО-ПРАКТИКА')).toBeTruthy();
    expect(screen.getByText('7704412966')).toBeTruthy();
    expect(screen.getByText('30.09.2028')).toBeTruthy();
    expect(screen.getByText(/проектная декларация застройщика/)).toBeTruthy();
    expect(screen.queryByText(/проверено/i)).toBeNull();
  });

  it('дата сведений стоит рядом с данными, а её отсутствие названо словами', () => {
    renderWithProviders(<RegistryPanel registry={view({ asOf: null })} />);
    expect(screen.getByText(/дата сведений в реестре не указана/)).toBeTruthy();
  });

  it('перенос срока показан как изменение, а не как новое значение молча', () => {
    renderWithProviders(
      <RegistryPanel
        registry={view({
          changes: [
            {
              asOf: '2026-09-21',
              fetchedAt: '2026-09-21T10:00:00.000Z',
              changes: [{ label: 'Срок сдачи', from: '30.09.2028', to: '31.03.2029' }],
            },
          ],
          coverage: { loaded: 2, truncated: false },
        })}
      />,
    );
    expect(screen.getByText('Что изменилось в реестре')).toBeTruthy();
    // Старое значение осталось видимым рядом с новым: иначе перенос срока не прочитать.
    expect(screen.getAllByText('30.09.2028').length).toBeGreaterThan(1);
    expect(screen.getByText('31.03.2029')).toBeTruthy();
  });

  it('неизменность за несколько снимков — это тоже сведение, и оно сказано', () => {
    renderWithProviders(<RegistryPanel registry={view({ coverage: { loaded: 5, truncated: false } })} />);
    expect(screen.getByText(/За 5 последних снимков значения не менялись/)).toBeTruthy();
  });
});
