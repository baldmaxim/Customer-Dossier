// Панель реестра (этап 20B): дата сведений, атрибуция и изменения между обновлениями.
// Данные синтетические; сеть и сервер не участвуют.
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IRegistryView } from '../api/types';
import { renderWithProviders } from '../test/render';
import { RegistryPanel } from './RegistryPanel';
import { RegistryPublicationBody } from './RegistryPublicationBody';

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

  it('показывает генподрядчика перед остальными характеристиками дома', () => {
    const { container } = renderWithProviders(<RegistryPanel registry={view({ fields: [
      { label: 'Количество этажей', value: '26' },
      { label: 'Генподрядчики', value: 'ООО СУ-10 (ИНН: 7736255508)' },
    ] })} />);
    const text = container.textContent ?? '';
    expect(text).toContain('ООО СУ-10 (ИНН: 7736255508)');
    expect(text.indexOf('Генподрядчики')).toBeLessThan(text.indexOf('Количество этажей'));
  });

  it('дата сведений стоит рядом с данными, а её отсутствие названо словами', () => {
    renderWithProviders(<RegistryPanel registry={view()} />);
    expect(screen.getByText('Сведения на 21.09.2026 (получены 21.09.2026)')).toBeTruthy();
  });

  it('без даты сведений — так и сказано', () => {
    renderWithProviders(<RegistryPanel registry={view({ asOf: null })} />);
    expect(screen.getByText(/Дата сведений в реестре не указана \(получены 21\.09\.2026\)/)).toBeTruthy();
  });

  it('форма собственности не дублируется: «ООО» перед полным названием не ставится', () => {
    renderWithProviders(
      <RegistryPanel registry={view({ developer: { name: 'Общество с ограниченной ответственностью «Демо»', legalForm: 'ООО', inn: null, ogrn: null } })} />,
    );
    expect(screen.getByText('Общество с ограниченной ответственностью «Демо»')).toBeTruthy();
    expect(screen.queryByText(/^ООО Общество/)).toBeNull();
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

  it('неизменность за несколько обновлений — это тоже сведение, и оно сказано', () => {
    renderWithProviders(<RegistryPanel registry={view({ coverage: { loaded: 5, truncated: false } })} />);
    expect(screen.getByText(/За последние 5\sобновлений реестра значения не менялись/)).toBeTruthy();
  });

  it('кратко: шесть главных полей, остальное — «Все сведения реестра»', () => {
    const { container } = renderWithProviders(
      <RegistryPanel
        variant="brief"
        registry={view({
          fields: [
            { label: 'Количество этажей', value: '26' },
            { label: 'Статус строительства', value: 'Строится' },
            { label: 'Сдача дома', value: 'IV квартал 2026' },
            { label: 'Количество квартир', value: '1024' },
            { label: 'Генподрядчики', value: 'ООО СУ-10' },
          ],
        })}
      />,
    );
    const brief = [...container.querySelectorAll('dt')].filter(dt => !dt.closest('details')).map(dt => dt.textContent);
    expect(brief).toEqual(['Адрес', 'Застройщик', 'Генподрядчики', 'Статус строительства', 'Сдача дома', 'Количество квартир']);
    const all = screen.getByText('Все сведения реестра').closest('details')!;
    expect(all.open).toBe(false);
    expect(within(all).getByText('Количество этажей')).toBeTruthy();
    expect(within(all).getByText('ИНН застройщика')).toBeTruthy();
  });

  it('адреса в значениях — ссылки в новой вкладке без передачи адреса портала', () => {
    renderWithProviders(<RegistryPanel registry={view({ fields: [{ label: 'Проектная декларация', value: 'см. https://наш.дом.рф/объект/62087.' }] })} />);
    const link = screen.getByRole('link', { name: 'https://наш.дом.рф/объект/62087' });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});

describe('текст записи реестра в посте', () => {
  it('поля — списком, главные первыми, исходный текст — под раскрытием', () => {
    const body = ['Объект: ЖК Демо', 'Количество этажей: 26', 'Адрес: Москва, участок 5', 'Застройщик: ООО «Демо»'].join('\n');
    const { container } = renderWithProviders(<RegistryPublicationBody body={body} representation="registry_object@1" />);
    expect([...container.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual(['Адрес', 'Застройщик', 'Количество этажей']);
    expect(screen.getByText('Исходный текст записи реестра').closest('details')?.open).toBe(false);
  });

  it('обычный пост — текстом, ссылки кликабельны', () => {
    renderWithProviders(<RegistryPublicationBody body="Подробности: https://example.test/news/1, фото в канале." representation="telegram_web_text@1" />);
    expect(screen.getByRole('link', { name: 'https://example.test/news/1' }).getAttribute('href')).toBe('https://example.test/news/1');
  });
});
