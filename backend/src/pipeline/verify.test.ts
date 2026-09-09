import { describe, it, expect } from 'vitest';

import {
  verifyExtraction,
  isQuoteVerbatim,
  isNameInQuote,
  isTaxIdPresentInBody,
  isPlausibleEventDate,
  isAmountInBody,
  isCityMentionedInBody,
  isAddressGroundedInBody,
} from './verify.js';
import { emptyExtraction, type IExtraction } from '../llm/schema.js';

const BODY = [
  'ТОО «BI Group» сорвало срок сдачи ЖК «Астана Тауэр» на восемь месяцев.',
  'Дольщики направили коллективное обращение в акимат Астаны.',
  'Заказчиком объекта выступает АО «Базис-А», ИНН 7707083893.',
  'Сумма контракта составила 12500000000 рублей.',
].join(' ');

const PUBLISHED = new Date('2026-09-01T00:00:00Z');

const company = (over: Partial<IExtraction['companies'][number]> = {}) => ({
  name: 'BI Group',
  legal_form: 'ТОО',
  tax_id: null,
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

describe('isTaxIdPresentInBody', () => {
  it('принимает ИНН, который есть в тексте', () => {
    expect(isTaxIdPresentInBody('7707083893', BODY)).toBe(true);
  });

  it('отклоняет ИНН с верной контрольной суммой, которого нет в тексте', () => {
    // Модель могла «вспомнить» настоящий ИНН другой компании.
    expect(isTaxIdPresentInBody('1027700132239', BODY)).toBe(false);
  });

  it('отклоняет число из текста, не являющееся идентификатором', () => {
    // 12500000000 в тексте есть, но контрольная сумма не сходится.
    expect(isTaxIdPresentInBody('12500000000', BODY)).toBe(false);
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

describe('isCityMentionedInBody', () => {
  it('принимает город из текста', () => {
    expect(isCityMentionedInBody('Астана', BODY)).toBe(true);
  });

  it('принимает город в падеже: в тексте «в Астане», модель отдаёт «Астана»', () => {
    expect(isCityMentionedInBody('Астана', 'Объект сдан в Астане в прошлом месяце')).toBe(true);
  });

  it('принимает несклоняемый Алматы', () => {
    expect(isCityMentionedInBody('Алматы', 'Строительство в Алматы продолжается')).toBe(true);
  });

  it('отклоняет город, дописанный по смыслу', () => {
    // Реальный случай: пост про московский ЗИЛ получил город Алматы просто
    // потому, что портал про Казахстан.
    const moscow = 'Реконструкция на Автозаводской улице, дом 25, продолжается.';
    expect(isCityMentionedInBody('Алматы', moscow)).toBe(false);
  });

  it('не путает разные города с общим началом', () => {
    expect(isCityMentionedInBody('Астана', 'Работы ведутся в Атырау')).toBe(false);
  });
});

describe('isAddressGroundedInBody', () => {
  it('принимает адрес, слова которого есть в тексте', () => {
    const body = 'Реконструкция на Автозаводской улице, дом 25, продолжается.';
    expect(isAddressGroundedInBody('Автозаводская улица, 25', body)).toBe(true);
  });

  it('отклоняет выдуманный адрес', () => {
    const body = 'Реконструкция на Автозаводской улице, дом 25, продолжается.';
    expect(isAddressGroundedInBody('проспект Мангилик Ел, 55', body)).toBe(false);
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

  it('отклоняет ИНН, которого нет в тексте, но саму компанию оставляет', () => {
    const result = verifyExtraction(
      { ...emptyExtraction(), doc_relevant: true, companies: [company({ tax_id: '1027700132239' })] },
      BODY,
      PUBLISHED,
    );
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]!.taxIdAccepted).toBeNull();
    expect(result.rejected.some(r => r.kind === 'tax_id')).toBe(true);
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
            amount_rub: null,
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

  it('обнуляет город, которого нет в тексте, но объект сохраняет', () => {
    const result = verifyExtraction(
      {
        ...emptyExtraction(),
        doc_relevant: true,
        projects: [project({ city: 'Караганда' })],
      },
      BODY,
      PUBLISHED,
    );
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]!.city).toBeNull();
    expect(result.rejected.some(r => r.kind === 'city')).toBe(true);
  });

  it('город из текста сохраняется', () => {
    const result = verifyExtraction(
      { ...emptyExtraction(), doc_relevant: true, projects: [project({ city: 'Астана' })] },
      BODY,
      PUBLISHED,
    );
    expect(result.projects[0]!.city).toBe('Астана');
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
