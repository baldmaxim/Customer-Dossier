import { describe, it, expect } from 'vitest';

import {
  verifyExtraction,
  isQuoteVerbatim,
  isNameInQuote,
  isBinPresentInBody,
  isPlausibleEventDate,
  isAmountInBody,
} from './verify.js';
import { emptyExtraction, type IExtraction } from '../llm/schema.js';

const BODY = [
  'ТОО «BI Group» сорвало срок сдачи ЖК «Астана Тауэр» на восемь месяцев.',
  'Дольщики направили коллективное обращение в акимат Астаны.',
  'Заказчиком объекта выступает АО «Базис-А», БИН 950140000415.',
  'Сумма контракта составила 12500000000 тенге.',
].join(' ');

const PUBLISHED = new Date('2026-09-01T00:00:00Z');

const company = (over: Partial<IExtraction['companies'][number]> = {}) => ({
  name: 'BI Group',
  legal_form: 'ТОО',
  bin: null,
  role: 'general_contractor' as const,
  sentiment: 'negative' as const,
  quote: 'ТОО «BI Group» сорвало срок сдачи ЖК «Астана Тауэр» на восемь месяцев.',
  confidence: 0.9,
  ...over,
});

const project = (over: Partial<IExtraction['projects'][number]> = {}) => ({
  name: 'Астана Тауэр',
  kind: 'residential' as const,
  city: 'Астана',
  address: null,
  stage: 'construction' as const,
  quote: 'ТОО «BI Group» сорвало срок сдачи ЖК «Астана Тауэр» на восемь месяцев.',
  confidence: 0.85,
  ...over,
});

describe('isQuoteVerbatim', () => {
  it('находит дословную цитату несмотря на пробелы и регистр', () => {
    expect(isQuoteVerbatim('ТОО  «BI  GROUP»  сорвало   срок сдачи', BODY)).toBe(true);
  });

  it('отклоняет пересказ', () => {
    expect(isQuoteVerbatim('BI Group задержала строительство жилого комплекса', BODY)).toBe(false);
  });

  it('отклоняет слишком короткую цитату', () => {
    expect(isQuoteVerbatim('ТОО', BODY)).toBe(false);
  });
});

describe('isNameInQuote', () => {
  it('находит имя в цитате', () => {
    expect(isNameInQuote('BI Group', 'ТОО «BI Group» сорвало срок сдачи')).toBe(true);
  });

  it('находит имя в другом падеже', () => {
    expect(isNameInQuote('Базис-А', 'заказчиком выступает АО «Базис-А», сообщили в компании')).toBe(true);
  });

  it('не находит выдуманное имя', () => {
    expect(isNameInQuote('Астана Строй Инвест', 'ТОО «BI Group» сорвало срок сдачи')).toBe(false);
  });
});

describe('isBinPresentInBody', () => {
  it('принимает БИН, который есть в тексте', () => {
    expect(isBinPresentInBody('950140000415', BODY)).toBe(true);
  });

  it('отклоняет выдуманный БИН', () => {
    expect(isBinPresentInBody('111140000415', BODY)).toBe(false);
  });
});

describe('isPlausibleEventDate', () => {
  it('принимает дату в допустимом окне', () => {
    expect(isPlausibleEventDate('2026-08-01', PUBLISHED)?.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('отклоняет дату до 1991 года', () => {
    expect(isPlausibleEventDate('1985-01-01', PUBLISHED)).toBeNull();
  });

  it('отклоняет дату дальше публикации плюс пять лет', () => {
    expect(isPlausibleEventDate('2035-01-01', PUBLISHED)).toBeNull();
  });

  it('отклоняет неверный формат', () => {
    expect(isPlausibleEventDate('август 2026', PUBLISHED)).toBeNull();
  });
});

describe('isAmountInBody', () => {
  it('принимает сумму из текста', () => {
    expect(isAmountInBody(12_500_000_000, BODY)).toBe(true);
  });

  it('отклоняет выдуманную сумму', () => {
    expect(isAmountInBody(777_777, BODY)).toBe(false);
  });
});

describe('verifyExtraction', () => {
  it('пропускает подтверждённые сущности', () => {
    const result = verifyExtraction(
      { ...emptyExtraction(), doc_relevant: true, companies: [company()], projects: [project()] },
      BODY,
      PUBLISHED,
    );
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]!.quoteVerified).toBe(true);
    expect(result.companies[0]!.confidenceFinal).toBeCloseTo(0.9);
  });

  it('отбрасывает компанию, которой нет в цитате', () => {
    const result = verifyExtraction(
      { ...emptyExtraction(), doc_relevant: true, companies: [company({ name: 'Казстройинвест' })] },
      BODY,
      PUBLISHED,
    );
    expect(result.companies).toHaveLength(0);
    expect(result.rejected[0]!.reason).toContain('имя отсутствует в цитате');
  });

  it('вдвое режет уверенность при неподтверждённой цитате', () => {
    const paraphrase = company({ quote: 'BI Group допустила задержку сдачи объекта в Астане' });
    const result = verifyExtraction(
      { ...emptyExtraction(), doc_relevant: true, companies: [paraphrase] },
      BODY,
      PUBLISHED,
    );
    expect(result.companies[0]!.quoteVerified).toBe(false);
    expect(result.companies[0]!.confidenceFinal).toBeCloseTo(0.45);
  });

  it('отклоняет выдуманный БИН, но саму компанию оставляет', () => {
    const result = verifyExtraction(
      { ...emptyExtraction(), doc_relevant: true, companies: [company({ bin: '111140000415' })] },
      BODY,
      PUBLISHED,
    );
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]!.binAccepted).toBeNull();
    expect(result.rejected.some(r => r.kind === 'bin')).toBe(true);
  });

  it('отбрасывает связь на отброшенную сущность, не роняя документ', () => {
    const result = verifyExtraction(
      {
        ...emptyExtraction(),
        doc_relevant: true,
        companies: [company()],
        projects: [project()],
        links: [
          { company: 'BI Group', project: 'Астана Тауэр', role: 'general_contractor', confidence: 0.9 },
          { company: 'Несуществующая', project: 'Астана Тауэр', role: 'contractor', confidence: 0.9 },
        ],
      },
      BODY,
      PUBLISHED,
    );
    expect(result.links).toHaveLength(1);
    expect(result.links[0]!.company).toBe('BI Group');
  });

  it('не пишет связь с ролью unknown', () => {
    const result = verifyExtraction(
      {
        ...emptyExtraction(),
        doc_relevant: true,
        companies: [company()],
        projects: [project()],
        links: [{ company: 'BI Group', project: 'Астана Тауэр', role: 'unknown', confidence: 0.9 }],
      },
      BODY,
      PUBLISHED,
    );
    expect(result.links).toHaveLength(0);
  });

  it('уверенность связи не превышает уверенность её концов', () => {
    const result = verifyExtraction(
      {
        ...emptyExtraction(),
        doc_relevant: true,
        companies: [company({ confidence: 0.5 })],
        projects: [project()],
        links: [
          { company: 'BI Group', project: 'Астана Тауэр', role: 'general_contractor', confidence: 0.99 },
        ],
      },
      BODY,
      PUBLISHED,
    );
    expect(result.links[0]!.confidenceFinal).toBeCloseTo(0.5);
  });

  it('отбрасывает событие без подтверждённого участника', () => {
    const result = verifyExtraction(
      {
        ...emptyExtraction(),
        doc_relevant: true,
        events: [
          {
            type: 'deadline_missed',
            company: 'Неизвестная компания',
            counterparty: null,
            project: null,
            occurred_on: null,
            amount_kzt: null,
            quote: 'ТОО «BI Group» сорвало срок сдачи',
            confidence: 0.9,
          },
        ],
      },
      BODY,
      PUBLISHED,
    );
    expect(result.events).toHaveLength(0);
  });

  it('нерелевантный документ даёт пустой результат', () => {
    const result = verifyExtraction(
      { ...emptyExtraction(), doc_relevant: false, companies: [company()] },
      BODY,
      PUBLISHED,
    );
    expect(result.relevant).toBe(false);
    expect(result.companies).toHaveLength(0);
  });
});
