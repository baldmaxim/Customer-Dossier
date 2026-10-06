import { describe, expect, it } from 'vitest';

import { heavierCard, nameWeight, type ICardWeight } from './mergeDirection.js';

const card = (over: Partial<ICardWeight> & { name?: string } = {}): ICardWeight => ({
  identifiers: 0,
  registry: 0,
  evidence: 0,
  shortName: nameWeight(over.name ?? 'Демо'),
  aliases: 0,
  ...over,
});

describe('направление слияния — к карточке, которую терять дороже', () => {
  it('«Sminex» со страницей ДОМ.РФ и сотней доказательств весомее «Смайнекс» с двумя написаниями', () => {
    const sminex = card({ name: 'Sminex', registry: 1, evidence: 163, aliases: 1 });
    const smainex = card({ name: 'Смайнекс', evidence: 11, aliases: 2 });
    expect(heavierCard(sminex, smainex)).toBe(true);
    expect(heavierCard(smainex, sminex)).toBe(false);
  });

  it('реквизит главнее доказательств, доказательства главнее написаний', () => {
    expect(heavierCard(card({ identifiers: 1 }), card({ evidence: 500, registry: 1 }))).toBe(true);
    expect(heavierCard(card({ evidence: 3 }), card({ evidence: 2, aliases: 9 }))).toBe(true);
  });

  it('при равных сведениях — короче название: именительный «Инград», а не «Инграда»', () => {
    expect(heavierCard(card({ name: 'Инград', evidence: 1 }), card({ name: 'Инграда', evidence: 1 }))).toBe(true);
    expect(heavierCard(card({ name: 'завода Кристалл' }), card({ name: 'завод Кристалл' }))).toBe(false);
  });

  it('полное равенство — направление очереди не меняется', () => {
    expect(heavierCard(card({ name: 'Bestcon' }), card({ name: 'Бэсткон' }))).toBe(false);
  });
});
