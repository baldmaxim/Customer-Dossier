// Скоринг кандидатов на слияние.
//
// Самая опасная логика в проекте: от неё зависит, склеятся ли две компании
// в одну. Ошибка в одну сторону даёт дубль — исправляется кнопкой в админке.
// Ошибка в другую сторону перемешивает упоминания, роли и события двух разных
// юрлиц, и разделить их обратно уже нечем.
//
// Здесь проверяется чистая арифметика решения. Запросы к БД не участвуют:
// кандидаты подаются готовыми.

import { describe, it, expect } from 'vitest';

import {
  scoreCandidate,
  AUTO_MERGE_SCORE,
  QUEUE_SCORE,
  type ICandidateRow,
  type IResolveInput,
} from './company.js';
import { isShortAmbiguousName, normalizeName } from './normalize.js';

const candidate = (over: Partial<ICandidateRow> = {}): ICandidateRow => ({
  id: 1,
  name: 'Стройинвест',
  tax_id: null,
  city: null,
  legal_form: null,
  s_latin: 0.9,
  s_norm: 0.9,
  ...over,
});

const input = (over: Partial<IResolveInput> = {}): IResolveInput => ({
  surface: 'Стройинвест',
  ...over,
});

describe('scoreCandidate — вес похожести', () => {
  it('полное совпадение обеих строк даёт высокий балл', () => {
    const result = scoreCandidate(candidate({ s_latin: 1, s_norm: 1 }), input(), null);
    // 0.55 * 1 + 0.25 * 1 = 0.80 — сама по себе похожесть до автослияния
    // не дотягивает, нужны подтверждающие признаки.
    expect(result.score).toBeCloseTo(0.8);
    expect(result.score).toBeLessThan(AUTO_MERGE_SCORE);
  });

  it('латиница весит больше нормализованной кириллицы', () => {
    const latinStrong = scoreCandidate(candidate({ s_latin: 1, s_norm: 0.5 }), input(), null);
    const normStrong = scoreCandidate(candidate({ s_latin: 0.5, s_norm: 1 }), input(), null);
    expect(latinStrong.score).toBeGreaterThan(normStrong.score);
  });
});

describe('scoreCandidate — идентификатор', () => {
  it('разные ИНН запрещают слияние навсегда, как бы ни совпадали названия', () => {
    const result = scoreCandidate(
      candidate({ s_latin: 1, s_norm: 1, tax_id: '7707083893' }),
      input({ taxId: '1027700132239' }),
      '1027700132239',
    );
    expect(result.forbidden).toBe(true);
    expect(result.score).toBe(0);
    expect(result.reasons.tax_id).toBe('conflict');
  });

  it('совпадение ИНН отмечается в обосновании', () => {
    const result = scoreCandidate(
      candidate({ tax_id: '7707083893' }),
      input({ taxId: '7707083893' }),
      '7707083893',
    );
    expect(result.forbidden).toBe(false);
    expect(result.reasons.tax_id).toBe('match');
  });

  it('когда идентификатора нет ни у кого, запрета нет', () => {
    const result = scoreCandidate(candidate(), input(), null);
    expect(result.forbidden).toBe(false);
    expect(result.reasons.tax_id).toBe('none');
  });
});

describe('scoreCandidate — город и форма', () => {
  it('совпадение города добавляет балл', () => {
    const withCity = scoreCandidate(
      candidate({ city: 'Москва' }),
      input({ city: 'Москва' }),
      null,
    );
    const without = scoreCandidate(candidate(), input(), null);
    expect(withCity.score).toBeGreaterThan(without.score);
    expect(withCity.reasons.city).toBe('match');
  });

  it('город в падеже считается совпавшим', () => {
    const result = scoreCandidate(
      candidate({ city: 'Москва' }),
      input({ city: 'москва' }),
      null,
    );
    expect(result.reasons.city).toBe('match');
  });

  it('конфликт организационной формы снижает балл, но не запрещает', () => {
    const conflict = scoreCandidate(
      candidate({ legal_form: 'ООО' }),
      input({ legalForm: 'АО' }),
      null,
    );
    const neutral = scoreCandidate(candidate(), input(), null);
    // Форму в тексте указывают небрежно, поэтому это сигнал, а не запрет.
    expect(conflict.score).toBeLessThan(neutral.score);
    expect(conflict.forbidden).toBe(false);
    expect(conflict.reasons.legal_form).toBe('conflict');
  });

  it('совпадение формы и города вместе доводит до автослияния', () => {
    const result = scoreCandidate(
      candidate({ s_latin: 1, s_norm: 1, city: 'Москва', legal_form: 'ООО' }),
      input({ city: 'Москва', legalForm: 'ООО' }),
      null,
    );
    expect(result.score).toBeGreaterThanOrEqual(AUTO_MERGE_SCORE);
  });
});

describe('scoreCandidate — границы', () => {
  it('балл не выходит за пределы от нуля до единицы', () => {
    const high = scoreCandidate(
      candidate({ s_latin: 1, s_norm: 1, city: 'Москва', legal_form: 'ООО' }),
      input({ city: 'Москва', legalForm: 'ООО' }),
      null,
    );
    const low = scoreCandidate(
      candidate({ s_latin: 0, s_norm: 0, legal_form: 'ООО' }),
      input({ legalForm: 'АО' }),
      null,
    );
    expect(high.score).toBeLessThanOrEqual(1);
    expect(low.score).toBeGreaterThanOrEqual(0);
  });

  it('без города или без формы автослияние недостижимо в принципе', () => {
    // Не случайность, а следствие весов: 0.55 + 0.25 + один бонус 0.10 = 0.90
    // при пороге 0.92. То есть автослияние требует, чтобы совпали ОБА
    // подтверждающих признака.
    //
    // Свойство зафиксировано тестом намеренно. После введения строгой проверки
    // города он часто оказывается null, и автослияние на практике почти
    // не срабатывает — почти всё уходит в ручную очередь. Это безопасно
    // (дубль дешевле ложного слияния), но нагружает человека. Если менять
    // веса или порог, менять осознанно и вместе с этим тестом.
    const idealButNoCity = scoreCandidate(
      candidate({ s_latin: 1, s_norm: 1, legal_form: 'ООО' }),
      input({ legalForm: 'ООО' }),
      null,
    );
    expect(idealButNoCity.score).toBeLessThan(AUTO_MERGE_SCORE);

    const idealButNoForm = scoreCandidate(
      candidate({ s_latin: 1, s_norm: 1, city: 'Москва' }),
      input({ city: 'Москва' }),
      null,
    );
    expect(idealButNoForm.score).toBeLessThan(AUTO_MERGE_SCORE);
  });

  it('серая зона порогов не пуста и упорядочена', () => {
    // Между QUEUE_SCORE и AUTO_MERGE_SCORE живёт ручное подтверждение.
    // Если пороги сойдутся, очередь слияний перестанет наполняться, и дубли
    // будут копиться молча.
    expect(QUEUE_SCORE).toBeLessThan(AUTO_MERGE_SCORE);
    expect(AUTO_MERGE_SCORE - QUEUE_SCORE).toBeGreaterThan(0.1);
  });
});

describe('короткие имена', () => {
  it('короткое односложное имя не допускается до автослияния', () => {
    // «Аском» и «Асем» дают ложных срабатываний больше, чем истинных:
    // на коротких строках триграммная похожесть завышена.
    expect(isShortAmbiguousName(normalizeName('Асем'))).toBe(true);
    expect(isShortAmbiguousName(normalizeName('Аском'))).toBe(true);
  });

  it('многословное или длинное имя ограничения не имеет', () => {
    expect(isShortAmbiguousName(normalizeName('Строй Инвест'))).toBe(false);
    expect(isShortAmbiguousName(normalizeName('Мосстройинвест'))).toBe(false);
  });
});
