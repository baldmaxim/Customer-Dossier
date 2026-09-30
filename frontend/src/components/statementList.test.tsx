// Фразы сводки: атрибуция — одна на группу, «Откуда известно» раскрывает цитаты, без «#id».
import { fireEvent, screen } from '@testing-library/react';
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

  it('«Откуда известно» раскрывает цитаты сведения; служебных номеров на экране нет', async () => {
    fakeApi([{ match: 'GET /api/assertions/5', respond: () => ({ status: 200, body: assertionResponse(5) }) }]);
    const { container } = renderWithProviders(<StatementList items={[statement('a', 'Бета-Демо — генподрядчик на объекте.', 'source_reported', [5])]} />);

    const toggle = screen.getByRole('button', { name: 'Откуда известно' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText('Бета-Демо заключила договор субподряда с Дельта-Демо')).toBeTruthy();
    // Фраза уже стоит выше — описание сведения не повторяется заголовком.
    expect(screen.queryByRole('heading', { name: /Бета-Демо →|Бета-Демо — договор/ })).toBeNull();
    expect(container.textContent).not.toMatch(/#\d|утверждение|доказательство/);
  });

  it('пустой список — словами, если сказано что', () => {
    renderWithProviders(<StatementList items={[]} empty="Договоров по объекту в собранных публикациях нет." />);
    expect(screen.getByText('Договоров по объекту в собранных публикациях нет.')).toBeTruthy();
  });
});
