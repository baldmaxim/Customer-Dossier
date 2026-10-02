// Результаты поиска компаний: одноимённые различимы строкой под названием, похожие по написанию — отдельно.

import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ICompanySearchItem } from '../../api/types';
import { renderWithProviders } from '../../test/render';
import { CompanyResults, companyFacts, placeFromAddress } from './CompanyResults';

const item = (over: Partial<ICompanySearchItem>): ICompanySearchItem => ({ id: 1, name: 'Донстрой', city: null, legalForm: null, score: 1, ...over });

describe('результаты поиска компаний', () => {
  it('город из юридического адреса ДОМ.РФ: «г Самара», «город Иркутск»; без города — первая часть', () => {
    expect(placeFromAddress('Самарская область, г Самара, ул Молодежная')).toBe('Самара');
    expect(placeFromAddress('Иркутская область, город Иркутск, улица Ленина')).toBe('Иркутск');
    expect(placeFromAddress('443010, Самарская область')).toBe('Самарская область');
    expect(placeFromAddress(null)).toBeNull();
  });

  it('строка отличий: форма, ИНН, группа, застройщики в группе; без сведений — ничего', () => {
    expect(
      companyFacts(item({ name: 'СЗ ДОНСТРОЙ', legalForm: 'ООО', identifiers: ['inn 6316056963', 'ogrn 1036300551979'], registryGroup: 'Новый ДОН' })),
    ).toBe('ООО · ИНН 6316056963 · группа «Новый ДОН»');
    expect(companyFacts(item({ legalForm: 'АО', members: 11 }))).toBe('АО · 11 застройщиков в группе');
    expect(companyFacts(item({}))).toBeNull();
  });

  it('совпавшие по названию — первыми, похожие по написанию — под подписью', () => {
    renderWithProviders(
      <CompanyResults
        wide
        items={[
          item({ id: 26, legalForm: 'АО', members: 11, projects: 4, publications: 66, exact: true }),
          item({ id: 3119, name: 'СЗ ДОНСТРОЙ', legalForm: 'ООО', registryAddress: 'Самарская область, г Самара', exact: false }),
          item({ id: 9, name: 'Дострой', exact: false }),
        ]}
      />,
    );
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows.map(r => r.textContent)).toEqual([
      'КомпанияГородОбъектовПубликаций',
      'ДонстройАО · 11 застройщиков в группе—466',
      'Похожие по написанию',
      'СЗ ДОНСТРОЙОООСамара——',
      'Дострой———',
    ]);
  });
});
