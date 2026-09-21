// Этап 03B без БД: нарезка в code points, покрытие, сборка кандидатов по чанкам.

import { describe, it, expect } from 'vitest';

import { buildCandidates, type IChunkInput } from './candidates.js';
import { runComplete } from './publish.js';
import { computeCoverage, planCodePointChunks } from './chunking.js';
import { buildFingerprint, type IModelProvider } from './provider.js';
import { company, event, extraction, INN_A, INN_B, link, project } from './__fixtures__/extraction.js';

const cp = (s: string): string[] => Array.from(s);

describe('planCodePointChunks', () => {
  it('короткий текст — один чанк на весь текст', () => {
    const plan = planCodePointChunks('Короткий пост 🏗️', 100, 3, 10);
    expect(plan).toEqual([{ index: 0, start: 0, end: cp('Короткий пост 🏗️').length, text: 'Короткий пост 🏗️' }]);
  });

  it('диапазоны в code points: текст чанка равен срезу исходника, эмодзи не разрываются', () => {
    const body = Array.from({ length: 30 }, (_, i) => `🚧 Абзац ${i} ${'слово '.repeat(8)}`).join('\n');
    const plan = planCodePointChunks(body, 120, 50, 20);
    expect(plan.length).toBeGreaterThan(1);
    for (const c of plan) expect(c.text).toBe(cp(body).slice(c.start, c.end).join(''));
    expect(computeCoverage(plan, cp(body).length).complete).toBe(true);
  });

  it('перекрытие: следующий чанк начинается раньше конца предыдущего', () => {
    const body = 'x'.repeat(1000);
    const plan = planCodePointChunks(body, 300, 10, 50);
    expect(plan[1]!.start).toBe(plan[0]!.end - 50);
  });

  it('хвост сверх лимита чанков не попадает в диапазоны — покрытие неполное', () => {
    const body = 'я'.repeat(1000);
    const plan = planCodePointChunks(body, 300, 2, 50);
    const coverage = computeCoverage(plan, 1000);
    expect(plan).toHaveLength(2);
    expect(coverage.complete).toBe(false);
    expect(coverage.coveredChars).toBe(550);
  });
});

describe('computeCoverage', () => {
  it('перекрытие не считается дважды', () => {
    expect(computeCoverage([{ start: 0, end: 60 }, { start: 40, end: 100 }], 100)).toEqual({
      coveredChars: 100,
      totalChars: 100,
      complete: true,
    });
  });

  it('дыра между диапазонами видна, даже если сумма длин велика', () => {
    const coverage = computeCoverage([{ start: 0, end: 50 }, { start: 0, end: 50 }, { start: 60, end: 100 }], 100);
    expect(coverage.complete).toBe(false);
    expect(coverage.coveredChars).toBe(90);
  });

  it('провалившийся последний чанк — непокрытый хвост', () => {
    expect(computeCoverage([{ start: 0, end: 70 }], 100).complete).toBe(false);
  });
});

describe('buildFingerprint', () => {
  const provider = (model: string, params: Record<string, unknown> = {}): IModelProvider => ({
    provider: 'fake',
    model,
    params,
    extract: async () => {
      throw new Error('не вызывается');
    },
  });
  const chunker = { chunkSize: 3500, maxChunks: 6, overlap: 400 };

  it('модель, параметры генерации и нарезка меняют отпечаток', () => {
    const base = buildFingerprint(provider('m1'), chunker).fingerprint;
    expect(buildFingerprint(provider('m1'), chunker).fingerprint).toBe(base);
    expect(buildFingerprint(provider('m2'), chunker).fingerprint).not.toBe(base);
    expect(buildFingerprint(provider('m1', { temperature: 0.5 }), chunker).fingerprint).not.toBe(base);
    expect(buildFingerprint(provider('m1'), { ...chunker, overlap: 200 }).fingerprint).not.toBe(base);
  });
});

const chunk = (body: string, index: number, start: number, end: number, data: IChunkInput['extraction']): IChunkInput => ({
  chunkId: 100 + index,
  index,
  start,
  text: cp(body).slice(start, end).join(''),
  extraction: data,
});

describe('buildCandidates', () => {
  it('одинаковые названия с разными ИНН в разных чанках — две сущности до резолвера', () => {
    const q1 = `ООО «Демо-Альфа» (ИНН ${INN_A}) начало работы`;
    const q2 = `ООО «Демо-Альфа» (ИНН ${INN_B}) получило иск`;
    const body = `${q1}.\n${'-'.repeat(50)}\n${q2}.`;
    const second = cp(body).length - cp(q2).length - 1;
    const build = buildCandidates(
      [
        chunk(body, 0, 0, cp(q1).length + 1, extraction({ companies: [company('Демо-Альфа', q1, { tax_id: INN_A })] })),
        chunk(body, 1, second, cp(body).length, extraction({ companies: [company('Демо-Альфа', q2, { tax_id: INN_B })] })),
      ],
      null,
    );
    expect(build.entities.map(e => e.taxId).sort()).toEqual([INN_A, INN_B].sort());
    expect(build.entities[0]!.mentionIds).toEqual(['c0:company:0']);
    expect(build.entities[1]!.mentionIds).toEqual(['c1:company:0']);
  });

  it('два разных суда одной компании не объединяются по type/company', () => {
    const q1 = '«Демо-Бета» проиграла спор с подрядчиком в арбитраже';
    const q2 = '«Демо-Бета» получила второй иск от поставщика';
    const body = `${q1}. ${q2}.`;
    const data = extraction({
      companies: [company('Демо-Бета', q1)],
      events: [event('court_case', q1, { company: 'Демо-Бета' }), event('court_case', q2, { company: 'Демо-Бета' })],
    });
    const build = buildCandidates([chunk(body, 0, 0, cp(body).length, data)], null);
    const courts = build.assertions.filter(a => a.content.eventType === 'court_case');
    expect(courts).toHaveLength(2);
    expect(courts.every(a => a.grounded)).toBe(true);
  });

  it('то же событие в перекрытии двух чанков — одно утверждение, позиция одна', () => {
    const q = '«Демо-Гамма» сорвала срок сдачи ЖК «Берег-Демо»';
    const body = `${'а'.repeat(40)} ${q}. ${'б'.repeat(40)}`;
    const qStart = 41;
    const qEnd = qStart + cp(q).length;
    const data = extraction({
      companies: [company('Демо-Гамма', q)],
      projects: [project('Берег-Демо', q)],
      events: [event('deadline_missed', q, { company: 'Демо-Гамма', project: 'Берег-Демо' })],
    });
    const build = buildCandidates(
      [chunk(body, 0, 0, qEnd + 2, data), chunk(body, 1, qStart - 5, cp(body).length, data)],
      null,
    );
    const events = build.assertions.filter(a => a.content.predicate === 'event');
    expect(events).toHaveLength(1);
    expect(events[0]!.evidence).toHaveLength(1);
    expect(events[0]!.evidence[0]!.spanStart).toBe(qStart);
    expect(cp(body).slice(qStart, qEnd).join('')).toBe(events[0]!.evidence[0]!.quote);
    // сущность из двух чанков — одна, с двумя mention-id
    const gamma = build.entities.find(e => e.name === 'Демо-Гамма')!;
    expect(gamma.mentionIds).toEqual(['c0:company:0', 'c1:company:0']);
  });

  it('связь ссылается на сущность своего чанка, абсолютные offsets доказательства с эмодзи', () => {
    const q = '🏗️ «Демо-Дельта» — генподрядчик ЖК «Лес-Демо»';
    const body = `🚧🚧 Вступление.\n${q}.`;
    const start = cp('🚧🚧 Вступление.\n').length;
    const data = extraction({
      companies: [company('Демо-Дельта', q)],
      projects: [project('Лес-Демо', q)],
      links: [link('Демо-Дельта', 'Лес-Демо', 'general_contractor')],
    });
    const build = buildCandidates([chunk(body, 0, 0, cp(body).length, data)], null);
    const participation = build.assertions.find(a => a.content.predicate === 'participates_in_project')!;
    const delta = build.entities.find(e => e.name === 'Демо-Дельта')!;
    const les = build.entities.find(e => e.name === 'Лес-Демо')!;
    expect(participation.content.subjectRef).toBe(delta.ref);
    expect(participation.content.objectRef).toBe(les.ref);
    expect(participation.evidence[0]!.spanStart).toBe(start);
    expect(participation.evidence[0]!.chunkId).toBe(100);
  });

  it('цитата из другого чанка не подтверждает (локальность)', () => {
    const q = '«Демо-Эпсилон» выиграла тендер';
    const body = `${q}.\n${'-'.repeat(60)}\nДругой абзац без компании.`;
    const tailStart = cp(body).length - cp('Другой абзац без компании.').length;
    const data = extraction({ companies: [company('Демо-Эпсилон', q)] });
    const build = buildCandidates([chunk(body, 1, tailStart, cp(body).length, data)], null);
    const mention = build.assertions.find(a => a.content.predicate === 'company_mentioned');
    expect(mention?.grounded ?? false).toBe(false);
  });

  it('нерелевантный ответ всех чанков — пустой нерелевантный набор', () => {
    const build = buildCandidates([chunk('текст', 0, 0, 5, extraction({ doc_relevant: false }))], null);
    expect(build.relevant).toBe(false);
    expect(build.assertions).toEqual([]);
  });
});

// Автопубликация включена по умолчанию, поэтому важно зафиксировать: она не
// смягчает условие публикации. Неполный, упавший и незавершённый запуск не
// публикуются ни при каком флаге — это проверка в publish.ts, а не в воркере.
describe('runComplete — что вообще можно публиковать', () => {
  it('полный завершённый запуск публикуется', () => {
    expect(runComplete({ status: 'completed', covered_chars: 1854, total_chars: 1854 })).toBe(true);
  });

  it('частичное покрытие текста не публикуется даже при статусе completed', () => {
    expect(runComplete({ status: 'completed', covered_chars: 1200, total_chars: 1854 })).toBe(false);
  });

  it('partial, failed, running и отсутствующий запуск не публикуются', () => {
    for (const status of ['partial', 'failed', 'running', 'queued', 'cancelled']) {
      expect(runComplete({ status, covered_chars: 1854, total_chars: 1854 }), status).toBe(false);
    }
    expect(runComplete(null)).toBe(false);
  });

  it('неизвестная длина текста не считается полным покрытием', () => {
    expect(runComplete({ status: 'completed', covered_chars: 0, total_chars: null })).toBe(false);
  });
});
