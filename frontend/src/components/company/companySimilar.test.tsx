// Плашка «Похожие компании»: ссылки на похожие карточки; пара, которую модель назвала одной компанией
// (например, «Сминекс» и «Sminex» — одно название в разной записи), подписана вердиктом.

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../../test/render';
import { CompanySimilar } from './CompanySimilar';

describe('CompanySimilar', () => {
  it('ссылки на похожие карточки; вердикт модели «та же» — приписка', async () => {
    fakeApi([
      {
        match: 'GET /api/companies/5/similar',
        respond: () => ({
          status: 200,
          body: {
            items: [
              { id: 41, name: 'Sminex', city: null, modelVerdict: 'same' },
              { id: 77, name: 'Смайнекс', city: 'Москва', modelVerdict: null },
            ],
          },
        }),
      },
    ]);
    renderWithProviders(<CompanySimilar companyId={5} />);
    expect((await screen.findByRole('link', { name: 'Sminex' })).getAttribute('href')).toBe('/company/41');
    expect(screen.getByRole('link', { name: 'Смайнекс' })).toBeTruthy();
    expect(screen.getByText(/модель: скорее та же компания/)).toBeTruthy();
    expect(screen.getAllByText(/модель:/)).toHaveLength(1);
  });
});
