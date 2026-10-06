// Этап 24D без БД: склейка генподрядчиков из ДОМ.РФ и из публикаций.

import { describe, it, expect } from 'vitest';

import { buildBuilders, type IPublicationBuilderRow, type IRegistryBuilderEntry } from './companyBuilders.js';

const objects = [
  { projectId: 1, name: 'ЖК Река' },
  { projectId: 2, name: 'ЖК Акценты' },
];

const su10 = { id: 10, name: 'СУ-10' };

describe('кто строит для компании (T24D-02)', () => {
  it('ДОМ.РФ по ИНН и публикация о той же компании — одна строка с двумя источниками', () => {
    const registry: IRegistryBuilderEntry[] = [
      { projectId: 1, name: 'ООО СУ-10', inn: '7736255508', asOf: '2026-09-30', company: su10, match: 'identifier' },
    ];
    const publications: IPublicationBuilderRow[] = [
      { projectId: 2, companyId: 10, companyName: 'СУ-10', inn: '7736255508', role: 'general_contractor', isCurrent: true, mentions: 3, lastPublication: new Date('2026-10-01T10:00:00Z') },
    ];
    const [item, ...rest] = buildBuilders(objects, registry, publications, new Set([99]));
    expect(rest).toEqual([]);
    expect(item).toMatchObject({
      key: 'company:10',
      company: su10,
      match: 'identifier',
      inGroup: false,
      roles: ['general_contractor'],
      sources: ['registry', 'publications'],
      registryNames: ['ООО СУ-10'],
      lastSeen: '2026-10-01T10:00:00.000Z',
    });
    expect(item!.objects.map(o => [o.name, o.sources, o.mentions])).toEqual([
      ['ЖК Акценты', ['publications'], 3],
      ['ЖК Река', ['registry'], null],
    ]);
  });

  it('генподрядчик без карточки в портале — по ИНН, без ссылки', () => {
    const registry: IRegistryBuilderEntry[] = [
      { projectId: 1, name: 'ООО Новый', inn: '7704412966', asOf: null, company: null, match: null },
    ];
    expect(buildBuilders(objects, registry, [], new Set())).toEqual([
      expect.objectContaining({ key: 'inn:7704412966', name: 'ООО Новый', company: null, match: null, inn: '7704412966' }),
    ]);
  });

  it('генподрядчик из своей группы помечен: строит своими силами', () => {
    const registry: IRegistryBuilderEntry[] = [
      { projectId: 1, name: 'ООО СЗ Свой', inn: '7704412966', asOf: null, company: { id: 5, name: 'СЗ Свой' }, match: 'identifier' },
    ];
    expect(buildBuilders(objects, registry, [], new Set([5]))[0]!.inGroup).toBe(true);
  });

  it('генподрядчик раньше подрядчика, дальше — по числу объектов', () => {
    const publications: IPublicationBuilderRow[] = [
      { projectId: 1, companyId: 20, companyName: 'Подряд-А', inn: null, role: 'contractor', isCurrent: true, mentions: 1, lastPublication: null },
      { projectId: 2, companyId: 20, companyName: 'Подряд-А', inn: null, role: 'contractor', isCurrent: true, mentions: 1, lastPublication: null },
      { projectId: 1, companyId: 30, companyName: 'Ген-Б', inn: null, role: 'general_contractor', isCurrent: false, mentions: 1, lastPublication: null },
    ];
    expect(buildBuilders(objects, [], publications, new Set()).map(b => b.name)).toEqual(['Ген-Б', 'Подряд-А']);
  });
});
