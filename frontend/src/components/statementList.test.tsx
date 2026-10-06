// Фразы сводки: атрибуция — одна на группу, «Откуда известно» открывает цитаты окном, без «#id».
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IStatement } from '../api/types';
import { assertionResponse } from '../test/assertionFixture';
import { fakeApi, renderWithProviders } from '../test/render';
import { StatementList } from './StatementList';

const statement = (code: string, text: string, attribution: IStatement['attribution'], assertionIds: number[]): IStatement => ({
  code,
  text,
  attribution,
  assertionIds,
  evidenceIds: [],
  quotes: [],
});

describe('StatementList', () => {
  it('атрибуция — один раз на группу подряд идущих фраз', () => {
    renderWithProviders(
      <StatementList
        items={[
          statement('a', 'Бета-Демо — генподрядчик на объекте.', 'source_reported', [5]),
          statement('b', 'Дельта-Демо — субподрядчик на объекте.', 'source_reported', [6]),
          statement('c', 'Договор поставки с Гамма-Демо.', 'analyst_disputed', [7]),
        ]}
      />,
    );
    expect(screen.getAllByText('в публикации сообщается')).toHaveLength(1);
    expect(screen.getAllByText('спорно по решению оператора')).toHaveLength(1);
  });

  it('«Откуда известно» открывает цитаты окном и грузит их только тогда; служебных номеров нет', async () => {
    const api = fakeApi([{ match: 'GET /api/assertions/5', respond: () => ({ status: 200, body: assertionResponse(5) }) }]);
    renderWithProviders(<StatementList items={[statement('a', 'Бета-Демо — генподрядчик на объекте.', 'source_reported', [5])]} />);

    expect(api.calls.some(c => c.url.startsWith('/api/assertions/'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Откуда известно' }));
    const dialog = screen.getByRole('dialog', { name: 'Откуда известно' });
    // Что известно — первой строкой окна, под ней цитаты.
    expect(within(dialog).getByText('Бета-Демо — генподрядчик на объекте.')).toBeTruthy();
    expect(await within(dialog).findByText('Бета-Демо заключила договор субподряда с Дельта-Демо')).toBeTruthy();
    // Фраза уже стоит выше — описание сведения не повторяется заголовком.
    expect(within(dialog).queryByRole('heading', { name: /Бета-Демо →|Бета-Демо — договор/ })).toBeNull();
    expect(dialog.textContent).not.toMatch(/#\d|утверждение|доказательство/);
  });

  it('пустой список — словами, если сказано что', () => {
    renderWithProviders(<StatementList items={[]} empty="Договоров по объекту в собранных публикациях нет." />);
    expect(screen.getByText('Договоров по объекту в собранных публикациях нет.')).toBeTruthy();
  });
});
