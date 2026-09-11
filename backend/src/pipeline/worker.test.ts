import { describe, it, expect } from 'vitest';

import { splitIntoChunks, mergeChunkExtractions } from './worker.js';
import { emptyExtraction, type IExtraction } from '../llm/schema.js';

describe('splitIntoChunks', () => {
  // Размер и число чанков передаются явно: тест проверяет алгоритм, а не
  // текущие значения по умолчанию из env. Иначе он ломается при каждой
  // подстройке под новую модель или видеокарту.
  const SIZE = 3500;
  const MAX = 6;

  it('короткий пост остаётся одним чанком', () => {
    expect(splitIntoChunks('Короткий пост про стройку', SIZE, MAX)).toHaveLength(1);
  });

  it('длинная статья режется на несколько чанков', () => {
    const article = Array.from({ length: 40 }, (_, i) => `Абзац ${i}. ${'слово '.repeat(60)}`).join('\n\n');
    const chunks = splitIntoChunks(article, SIZE, MAX);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(MAX);
  });

  it('число чанков не превышает заданный предел', () => {
    const huge = 'а'.repeat(200_000);
    expect(splitIntoChunks(huge, SIZE, MAX).length).toBeLessThanOrEqual(MAX);
    expect(splitIntoChunks(huge, SIZE, 2).length).toBeLessThanOrEqual(2);
  });

  it('меньший размер чанка даёт больше чанков на тот же текст', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Строка ${i} ${'x'.repeat(200)}`).join('\n');
    const coarse = splitIntoChunks(text, 6000, 10).length;
    const fine = splitIntoChunks(text, 2000, 10).length;
    expect(fine).toBeGreaterThan(coarse);
  });

  it('чанки перекрываются, чтобы факт на границе не потерялся', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Строка ${i} ${'x'.repeat(200)}`).join('\n');
    const chunks = splitIntoChunks(text, SIZE, MAX);
    expect(chunks.length).toBeGreaterThan(1);
    const tail = chunks[0]!.slice(-100);
    expect(chunks[1]).toContain(tail.slice(0, 50));
  });
});

describe('mergeChunkExtractions', () => {
  const withCompany = (name: string, confidence = 0.9): IExtraction => ({
    ...emptyExtraction(),
    doc_relevant: true,
    companies: [
      {
        name,
        legal_form: null,
        tax_id: null,
        role: 'contractor',
        sentiment: 'neutral',
        quote: `цитата про ${name}`,
        confidence,
      },
    ],
  });

  it('схлопывает одну компанию, найденную в разных чанках', () => {
    const merged = mergeChunkExtractions([withCompany('BI Group'), withCompany('BI Group')]);
    expect(merged.companies).toHaveLength(1);
  });

  it('регистр не мешает схлопыванию', () => {
    const merged = mergeChunkExtractions([withCompany('BI Group'), withCompany('bi group')]);
    expect(merged.companies).toHaveLength(1);
  });

  it('разные компании сохраняются обе', () => {
    const merged = mergeChunkExtractions([withCompany('BI Group'), withCompany('Базис-А')]);
    expect(merged.companies).toHaveLength(2);
  });

  it('документ релевантен, если хотя бы один чанк релевантен', () => {
    const irrelevant = { ...emptyExtraction(), doc_relevant: false };
    expect(mergeChunkExtractions([irrelevant, withCompany('BI Group')]).doc_relevant).toBe(true);
  });

  it('все чанки нерелевантны — документ нерелевантен', () => {
    const irrelevant = { ...emptyExtraction(), doc_relevant: false };
    expect(mergeChunkExtractions([irrelevant, irrelevant]).doc_relevant).toBe(false);
  });

  it('дублирующиеся связи и события схлопываются', () => {
    const part: IExtraction = {
      ...emptyExtraction(),
      doc_relevant: true,
      links: [{ company: 'BI Group', project: 'Астана Тауэр', role: 'contractor', confidence: 0.8 }],
      events: [
        {
          type: 'delay',
          company: 'BI Group',
          counterparty: null,
          project: 'Астана Тауэр',
          occurred_on: null,
          amount_rub: null,
          quote: 'задержка',
          confidence: 0.8,
        },
      ],
    };
    const merged = mergeChunkExtractions([part, part]);
    expect(merged.links).toHaveLength(1);
    expect(merged.events).toHaveLength(1);
  });

  it('пустой список даёт пустое извлечение', () => {
    const merged = mergeChunkExtractions([]);
    expect(merged.doc_relevant).toBe(false);
    expect(merged.companies).toHaveLength(0);
  });
});
