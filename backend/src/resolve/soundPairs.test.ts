import { describe, expect, it } from 'vitest';

import { SOUND_GROUP_MAX, buildSoundPairs, type ISoundName } from './soundPairs.js';

const name = (companyId: number, value: string, identified = false): ISoundName => ({ companyId, name: value, identified });

describe('buildSoundPairs — пары «возможный дубль» по звучанию', () => {
  it('Sminex, Сминекс и Смайнекс — три пары, новичок — больший id', () => {
    const plan = buildSoundPairs([name(41, 'Sminex', true), name(90, 'Сминекс'), name(120, 'Смайнекс')]);
    expect(plan.pairs.map(p => [p.sourceId, p.targetId])).toEqual([
      [90, 41],
      [120, 41],
      [120, 90],
    ]);
    expect(plan.pairs.every(p => p.sound === 'smnks')).toBe(true);
  });

  it('написание (алиас) сводит так же, как название; одна компания — одна сторона', () => {
    const plan = buildSoundPairs([name(1, 'Sminex'), name(1, 'Смайнекс'), name(2, 'Сминекс')]);
    expect(plan.pairs).toHaveLength(1);
    expect(plan.pairs[0]).toMatchObject({ sourceId: 2, targetId: 1 });
  });

  it('обе стороны с реквизитом — разные юрлица, пары нет', () => {
    expect(buildSoundPairs([name(1, 'Sminex', true), name(2, 'Сминекс', true)]).pairs).toEqual([]);
  });

  it('общий ключ больше предела — в отчёт, без пар', () => {
    const many = Array.from({ length: SOUND_GROUP_MAX + 1 }, (_, i) => name(i + 1, i % 2 === 0 ? 'Сминекс' : 'Sminex'));
    const plan = buildSoundPairs(many);
    expect(plan.pairs).toEqual([]);
    expect(plan.tooCommon).toEqual([{ sound: 'smnks', companies: SOUND_GROUP_MAX + 1 }]);
  });

  it('короткие имена и роли вместо названий не участвуют', () => {
    expect(buildSoundPairs([name(1, 'ПИК'), name(2, 'Пак'), name(3, 'застройщик'), name(4, 'Застройщик')]).pairs).toEqual([]);
  });
});
