import { describe, it, expect } from 'vitest';

import {
  normalizeName,
  isJunkName,
  isShortAmbiguousName,
  isValidBin,
} from './normalize.js';

describe('normalizeName — компании', () => {
  it('сводит три написания BI Group к одному ключу', () => {
    const variants = ['ТОО "BI Group"', 'БИ Групп', 'BI Group', 'BI Group ТОО'];
    const keys = variants.map(v => normalizeName(v).key);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('bigroup');
  });

  it('сводит Базис-А и Bazis-A', () => {
    expect(normalizeName('АО Базис-А').key).toBe('bazisa');
    expect(normalizeName('Bazis-A').key).toBe('bazisa');
    expect(normalizeName('ТОО «Базис А»').key).toBe('bazisa');
  });

  it('выносит ОПФ в отдельное поле, а не в имя', () => {
    const r = normalizeName('ТОО "BI Group"');
    expect(r.legalForm).toBe('ТОО');
    expect(r.display).toBe('BI Group');
    expect(r.norm).toBe('bi group');
  });

  it('дефис становится пробелом, а не склеивает слова', () => {
    expect(normalizeName('Базис-А').norm).toBe('базис а');
  });

  it('казахские буквы сводятся к русским', () => {
    expect(normalizeName('Құрылыс').norm).toBe('курылыс');
    expect(normalizeName('Курылыс').key).toBe(normalizeName('Құрылыс').key);
  });

  it('ё и е не различаются', () => {
    expect(normalizeName('Сёгун').key).toBe(normalizeName('Сегун').key);
  });

  it('не срезает ОПФ, если она часть слова', () => {
    // «ипотека» не должна превратиться в «отека» из-за формы «ип»
    expect(normalizeName('Ипотека Строй').norm).toBe('ипотека строй');
    expect(normalizeName('Ипотека Строй').legalForm).toBeNull();
  });

  it('строка из одной ОПФ не превращается в пустую', () => {
    const r = normalizeName('ТОО');
    expect(r.norm.length).toBeGreaterThan(0);
  });

  it('нормализует варианты написания group', () => {
    expect(normalizeName('Азия Групп').key).toBe(normalizeName('Asia Group').key);
  });

  it('нормализация идемпотентна: повтор по display даёт тот же ключ', () => {
    const once = normalizeName('ТОО "BI Group"');
    const twice = normalizeName(once.display);
    expect(twice.key).toBe(once.key);
  });
});

describe('normalizeName — объекты', () => {
  it('срезает ЖК как префикс объекта', () => {
    const r = normalizeName('ЖК «Астана Тауэр»', 'project');
    expect(r.display).toBe('Астана Тауэр');
    expect(r.norm).toBe('астана тауэр');
  });

  it('ЖК у компании не срезается (это не ОПФ)', () => {
    const r = normalizeName('ЖК Астана', 'company');
    expect(r.norm).toBe('жк астана');
  });

  it('микрорайон и мкр дают один ключ', () => {
    expect(normalizeName('мкр Самал', 'project').key).toBe(
      normalizeName('микрорайон Самал', 'project').key,
    );
  });
});

describe('isJunkName', () => {
  it('отсекает роли вместо названий', () => {
    for (const junk of ['Заказчик', 'подрядчик', 'ГЕНПОДРЯДЧИК', 'Акимат']) {
      expect(isJunkName(normalizeName(junk)), junk).toBe(true);
    }
  });

  it('пропускает нормальные названия', () => {
    expect(isJunkName(normalizeName('BI Group'))).toBe(false);
    expect(isJunkName(normalizeName('Базис-А'))).toBe(false);
  });

  it('отсекает слишком короткое', () => {
    expect(isJunkName(normalizeName('АБ'))).toBe(true);
  });
});

describe('isShortAmbiguousName', () => {
  it('короткое односложное — запрет автослияния', () => {
    expect(isShortAmbiguousName(normalizeName('Асем'))).toBe(true);
  });

  it('длинное или многословное — автослияние разрешено', () => {
    expect(isShortAmbiguousName(normalizeName('BI Group'))).toBe(false);
    expect(isShortAmbiguousName(normalizeName('Казахстройинвест'))).toBe(false);
  });
});

describe('isValidBin', () => {
  it('принимает корректный БИН юрлица', () => {
    expect(isValidBin('123456400012')).toBe(true);
  });

  it('отклоняет ИИН (5-я цифра не 4/5/6) и мусор', () => {
    expect(isValidBin('123406700012')).toBe(false); // 5-я цифра 0
    expect(isValidBin('12345')).toBe(false);
    expect(isValidBin('абвгде123456')).toBe(false);
  });
});
