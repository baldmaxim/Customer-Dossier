import { describe, it, expect } from 'vitest';

import {
  normalizeName,
  isJunkName,
  isShortAmbiguousName,
  isValidInn,
  isValidOgrn,
  isValidTaxId,
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

describe('isValidInn', () => {
  // Числа подобраны так, чтобы контрольная сумма сходилась: проверяем алгоритм,
  // а не совпадение с чьим-то настоящим ИНН.
  it('принимает ИНН организации (10 цифр)', () => {
    expect(isValidInn('7707083893')).toBe(true);
  });

  it('принимает ИНН физлица и ИП (12 цифр)', () => {
    expect(isValidInn('770708389324')).toBe(true);
  });

  it('отклоняет ИНН с испорченной контрольной цифрой', () => {
    expect(isValidInn('7707083894')).toBe(false);
  });

  it('отклоняет неверную длину и мусор', () => {
    expect(isValidInn('12345')).toBe(false);
    expect(isValidInn('abcdefghij')).toBe(false);
  });
});

describe('isValidOgrn', () => {
  it('принимает корректный ОГРН', () => {
    expect(isValidOgrn('1027700132239')).toBe(true);
  });

  it('отклоняет ОГРН с испорченной контрольной цифрой', () => {
    expect(isValidOgrn('1027700132230')).toBe(false);
  });
});

describe('isValidTaxId', () => {
  it('принимает и ИНН, и ОГРН', () => {
    expect(isValidTaxId('7707083893')).toBe(true);
    expect(isValidTaxId('1027700132239')).toBe(true);
  });

  it('отклоняет длинное число, которое не является идентификатором', () => {
    // Кадастровый номер, сумма без пробелов, номер дела — модель их подставляет.
    expect(isValidTaxId('123456789012')).toBe(false);
  });
});
