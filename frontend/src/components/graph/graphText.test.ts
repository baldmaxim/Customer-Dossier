// Слова схемы: машинные значения — через словари, подписи узлов в две строки, пояснения один раз.
import { describe, expect, it } from 'vitest';

import type { IGraphEdge } from '../../api/types';
import { edgeCaption, edgeFacts, graphNotes, nodeLines, nodeSubtitle, wrapLabel } from './graphText';

const edge = (over: Partial<IGraphEdge> = {}): IGraphEdge => ({
  key: 'e',
  type: 'contract',
  from: 'c:1',
  to: 'c:2',
  assertionId: 5,
  role: 'general_contract',
  building: null,
  workPackage: null,
  validFrom: null,
  validTo: null,
  periodPrecision: 'unknown',
  status: 'text_grounded',
  polarity: 'positive',
  modality: 'reported_fact',
  supports: 1,
  contradicts: 0,
  contextProjectId: null,
  details: [],
  ...over,
});

describe('подписи схемы', () => {
  it('вид узла — словами из словаря, незнакомое значение не печатается сырым', () => {
    expect(nodeSubtitle({ kind: 'company', subtype: 'legal_entity' })).toBe('компания · юрлицо');
    expect(nodeSubtitle({ kind: 'project', subtype: 'complex' })).toBe('объект · комплекс');
    expect(nodeSubtitle({ kind: 'company', subtype: 'unknown' })).toBe('компания');
    expect(nodeSubtitle({ kind: 'company', subtype: 'weird_machine_value' })).toBe('компания');
  });

  it('название — в две строки по словам, не обрезкой до 22 знаков; длинное — с многоточием', () => {
    expect(wrapLabel('ООО «Инжтрансстрой-СПб»')).toEqual(['ООО «Инжтрансстрой-СПб»']);
    const lines = wrapLabel('Мост через Оку в створе улицы Сормовской');
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toContain('Мост через Оку');
    const long = wrapLabel('Многофункциональный жилой комплекс с подземным паркингом и встроенно-пристроенными помещениями');
    expect(long).toHaveLength(2);
    expect(long[1]?.endsWith('…')).toBe(true);
    for (const line of long) expect(line.length).toBeLessThanOrEqual(26);
  });

  it('полная форма собственности в узле сокращается — остаётся место для самого названия', () => {
    const lines = nodeLines('Общество с ограниченной ответственностью Специализированный застройщик "Северо-Западная корпорация"');
    expect(lines[0]).toMatch(/^ООО СЗ/);
  });

  it('договор подписан как сообщённый источником, без повтора слова «договор»', () => {
    expect(edgeCaption(edge())).toBe('договор генподряда (сообщён источником)');
    expect(edgeCaption(edge({ type: 'participation', role: 'customer', building: 'корпус 12' }))).toBe('участие в объекте: заказчик · корпус 12');
    expect(edgeCaption(edge({ modality: 'planned' }))).toContain('план');
    expect(edgeCaption(edge({ polarity: 'negative' }))).toContain('отрицается');
  });

  it('пояснение к связи без сведения — без служебных номеров редакций', () => {
    const facts = edgeFacts(edge({ type: 'co_mentioned', assertionId: null, supports: 3, details: ['упомянуты вместе в редакциях: #12, #15'] }));
    expect(facts.join(' ')).toMatch(/3\sпубликациях/);
    expect(facts.join(' ')).not.toMatch(/#\d/);
  });

  it('пояснения сервера пересказаны без «рёбер» и «утверждений», граница обхода — словами', () => {
    const notes = graphNotes({
      nodes: [],
      edges: [],
      truncated: true,
      notes: [
        'Рёбра — только утверждения со своим основанием; путь через третью компанию не означает прямого договора.',
        'Глубина ограничена 2: у крайних узлов могут быть другие связи.',
      ],
    });
    const text = notes.join(' ');
    expect(text).toContain('промежуточные звенья не достраиваются');
    expect(text).toContain('не дальше 2 шагов от центра');
    expect(text).toContain('Показаны не все связи');
    expect(text).not.toMatch(/Рёбра|утвержден/);
  });
});
