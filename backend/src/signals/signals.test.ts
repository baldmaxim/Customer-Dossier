// Этап 07 без БД: правила signals@1 на замороженном срезе. Данные синтетические.

import { describe, it, expect } from 'vitest';

import { dateStatus, overlap, share, windowMonths } from './intervals.js';
import { computeCompanySignals, originFamilies } from './rules.js';
import type { ICompanySignalInput, ISignalAssertion, ISignalPublication } from './types.js';

const CUTOFF = new Date('2026-09-15T12:00:00Z');
const ME = 1;

let nextId = 100;
const assertion = (over: Partial<ISignalAssertion>, items: number[] = [1]): ISignalAssertion => {
  nextId += 1;
  return {
    id: nextId,
    predicate: 'event',
    role: null,
    eventType: 'delay',
    status: 'text_grounded',
    origin: 'extraction',
    needsRevalidation: false,
    polarity: 'positive',
    modality: 'reported_fact',
    subjectCompanyId: ME,
    subjectProjectId: null,
    objectCompanyId: null,
    objectProjectId: null,
    counterpartyCompanyId: null,
    contextProjectId: null,
    scopeBuilding: null,
    workPackage: null,
    workPackageLabel: null,
    validFrom: null,
    validTo: null,
    periodPrecision: 'unknown',
    caseNumber: null,
    proceduralRole: null,
    counterpartyRole: null,
    eventStage: null,
    eventOutcome: null,
    valueType: null,
    valueNumeric: null,
    valueCurrency: null,
    evidence: items.map((sourceItemId, i) => ({ id: nextId * 10 + i, stance: 'supports' as const, sourceItemId })),
    ...over,
  };
};

const publication = (id: number, over: Partial<ISignalPublication> = {}): ISignalPublication => ({
  sourceItemId: id,
  sourceKey: `channel_${id}`,
  publishedAt: '2026-09-10T09:00:00Z',
  completeness: 'full',
  dedupHash: `hash_${id}`,
  forwardOrigin: null,
  observations: 1,
  ...over,
});

const input = (assertions: ISignalAssertion[], publications: ISignalPublication[], over: Partial<ICompanySignalInput> = {}): ICompanySignalInput => ({
  companyId: ME,
  entityType: 'legal_entity',
  identifiers: [],
  aliases: 0,
  openAmbiguities: 0,
  pendingMerges: 0,
  legacyUnimported: { participations: 0, events: 0 },
  assertions,
  publications,
  ...over,
});

describe('TC-060: неизвестная дата события и свежая публикация', () => {
  it('старое событие без даты не входит в окно 12 месяцев; отдельно — окно публикаций 90 дней', () => {
    const undated = assertion({ eventType: 'delay' }, [1]);
    const dated = assertion({ eventType: 'delay', validFrom: '2026-03-01', validTo: '2026-03-31', periodPrecision: 'month' }, [2]);
    const old = assertion({ eventType: 'delay', validFrom: '2023-01-01', validTo: '2023-12-31', periodPrecision: 'year' }, [3]);
    const s = computeCompanySignals(input([undated, dated, old], [publication(1), publication(2), publication(3, { publishedAt: '2024-01-01T00:00:00Z' })]), CUTOFF);

    expect(s.media.eventsDated12m).toMatchObject({ value: 1, ids: [dated.id], window: { from: '2025-09-15', to: '2026-09-15', basis: 'event_date' } });
    expect(s.media.eventsUndated.ids).toEqual([undated.id]);
    expect(s.media.eventsUndatedPublished90d).toMatchObject({ value: 1, ids: [undated.id], window: { basis: 'publication_date' } });
    expect(s.media.events.find(e => e.assertionId === old.id)?.dateStatus).toBe('before_window');
  });

  it('будущая дата и интервал через границу окна — явные метки', () => {
    const window = windowMonths(CUTOFF, 12, 'event_date');
    expect(dateStatus('2027-01-01', null, window)).toBe('future');
    expect(dateStatus('2025-01-01', '2025-12-31', window)).toBe('boundary');
    expect(dateStatus('2026-09-01', '2026-09-30', window)).toBe('boundary');
    expect(dateStatus(null, null, window)).toBe('undated');
    const future = assertion({ validFrom: '2027-03-01', validTo: '2027-03-31', periodPrecision: 'month' });
    const year = assertion({ validFrom: '2025-01-01', validTo: '2025-12-31', periodPrecision: 'year' });
    const s = computeCompanySignals(input([future, year], [publication(1)]), CUTOFF);
    expect(s.media.eventsFuture.ids).toEqual([future.id]);
    expect(s.media.eventsBoundary12m.ids).toEqual([year.id]);
    expect(s.media.eventsDated12m.ids).toEqual([year.id]);
  });
});

describe('TC-061: участник, пришедший позже события, его не наследует', () => {
  it('задержка 2024 года и участие с июня 2026 — периоды не пересекаются; неизвестные даты — «неизвестно»', () => {
    const delay2024 = { validFrom: '2024-01-01', validTo: '2024-12-31' };
    expect(overlap({ validFrom: '2026-06-01', validTo: null }, delay2024)).toBe('no_overlap');
    expect(overlap({ validFrom: '2023-06-01', validTo: null }, delay2024)).toBe('overlaps');
    expect(overlap({ validFrom: null, validTo: null }, delay2024)).toBe('unknown');
    expect(overlap({ validFrom: null, validTo: '2023-12-31' }, delay2024)).toBe('no_overlap');
    expect(overlap({ validFrom: '2026-06-01', validTo: null }, { validFrom: null, validTo: null })).toBe('unknown');
  });

  it('событие объекта без упоминания компании не попадает в её события', () => {
    const projectDelay = assertion({ subjectCompanyId: null, subjectProjectId: 7, eventType: 'delay', validFrom: '2026-01-01', validTo: '2026-01-31' });
    const s = computeCompanySignals(input([projectDelay], [publication(1)]), CUTOFF);
    expect(s.media.events).toEqual([]);
    expect(s.media.note).toContain('не найдено');
  });
});

describe('TC-062: пять перепечаток', () => {
  it('пять публикаций, одна семья, одно событие; происхождение без пересылки — не установлено', () => {
    const items = [1, 2, 3, 4, 5];
    const event = assertion({ eventType: 'milestone', validFrom: '2026-09-01', validTo: '2026-09-01', periodPrecision: 'day' }, items);
    const pubs = items.map(i => publication(i, { dedupHash: 'same' }));
    const s = computeCompanySignals(input([event], pubs), CUTOFF);
    expect(s.media.publications.value).toBe(5);
    expect(s.media.families.value).toBe(1);
    expect(s.media.familiesByOrigin.unknown.value).toBe(1);
    expect(s.media.familiesByOrigin.established.value).toBe(0);
    expect(s.media.events).toHaveLength(1);
    expect(s.media.events[0]).toMatchObject({ publications: 5, families: 1 });
  });

  it('пересылки с публикацией первоисточника в выборке — установлено; первоисточника нет — только назван', () => {
    const withOrigin = originFamilies([
      publication(1, { sourceKey: 'primary', dedupHash: 'x' }),
      publication(2, { dedupHash: 'x', forwardOrigin: '@Primary' }),
    ]);
    expect(withOrigin).toEqual([{ key: 'family:1', members: [1, 2], origin: 'established' }]);
    const namedOnly = originFamilies([publication(3, { dedupHash: 'y', forwardOrigin: 'elsewhere' }), publication(4, { dedupHash: 'y' })]);
    expect(namedOnly[0]!.origin).toBe('named');
    // Разные посты одного канала не склеиваются по имени канала.
    expect(originFamilies([publication(5, { forwardOrigin: 'chan' }), publication(6, { forwardOrigin: 'chan' })])).toHaveLength(2);
  });
});

describe('TC-063: ноль наблюдений — недостаточно данных', () => {
  it('нет публикаций: insufficient_data и null, а не 0 % и не «зелёный»', () => {
    const s = computeCompanySignals(input([], []), CUTOFF);
    expect(s.identity.coverage.publications).toMatchObject({ value: null, status: 'insufficient_data' });
    expect(s.media.publications).toMatchObject({ value: null, status: 'insufficient_data' });
    expect(s.media.families.status).toBe('insufficient_data');
    expect(s.media.reviewedShare).toMatchObject({ value: null, status: 'insufficient_data', denominator: 0 });
    expect(s.experience.reviewed).toMatchObject({ value: null, status: 'insufficient_data' });
    expect(s.identity.status).toBe('name_only');
    expect(JSON.stringify(s)).not.toMatch(/green|red|risk/);
  });

  it('доля при ненулевом знаменателе считается, при нулевом — нет', () => {
    expect(share([1], 4, 'r')).toMatchObject({ value: 0.25, denominator: 4, status: 'ok' });
    expect(share([], 0, 'r')).toMatchObject({ value: null, status: 'insufficient_data' });
  });
});

describe('суды и проверка: истец не нарушитель, отклонённое видно', () => {
  it('роль в деле по стороне компании; стадии одного дела вместе; отклонённое и спорное — не reviewed', () => {
    const filed = assertion({ eventType: 'court_case', caseNumber: 'А40-1/2026', eventStage: 'claim_filed', proceduralRole: 'plaintiff', counterpartyCompanyId: 2, validFrom: '2026-02-01', validTo: '2026-02-01', periodPrecision: 'day' });
    const decision = assertion({ eventType: 'court_case', caseNumber: 'А40- 1/2026', eventStage: 'decision', eventOutcome: 'satisfied', proceduralRole: 'plaintiff', status: 'reviewed_supported' });
    const asDefendant = assertion({ eventType: 'court_case', subjectCompanyId: 3, counterpartyCompanyId: ME, counterpartyRole: 'defendant', status: 'disputed' });
    const rejected = assertion({ eventType: 'bankruptcy_filing', status: 'rejected' });
    const planned = assertion({ eventType: 'construction_start', modality: 'planned' });
    const negative = assertion({ eventType: 'delay', polarity: 'negative' });
    const s = computeCompanySignals(input([filed, decision, asDefendant, rejected, planned, negative], [publication(1)]), CUTOFF);

    expect(s.media.courtRoles).toEqual({ plaintiff: 1, defendant: 1, other: 0, unknown: 0 });
    const numbered = s.media.legalCases.find(c => c.caseKey === 'case:А40-1/2026');
    expect(numbered?.stages.map(x => x.stage)).toEqual(['decision', 'claim_filed']);
    expect(s.media.eventsByReview).toMatchObject({ reviewed: 1, text_grounded: 1, disputed: 1, rejected: 1 });
    expect(s.media.events.find(e => e.assertionId === rejected.id)?.review).toBe('rejected');
    expect(s.media.reviewedShare).toMatchObject({ value: 0.333, denominator: 3 });
    expect(s.media.notCounted.map(n => n.assertionId).sort()).toEqual([planned.id, negative.id].sort());
    expect(s.media.events.every(e => e.attribution === 'source_reported')).toBe(true);
  });
});

describe('опыт: объект, роль, пакет, период — без сумм', () => {
  it('план и отрицание не опыт; договоры перечислены с суммой как написано, без итога', () => {
    const gc = assertion({ predicate: 'participates_in_project', role: 'general_contractor', objectProjectId: 7, scopeBuilding: 'корпус 2', validFrom: '2026-06-01', periodPrecision: 'month' });
    const vk = assertion({ predicate: 'participates_in_project', role: 'subcontractor', objectProjectId: 8, workPackage: 'ВК', status: 'reviewed_supported' });
    const planned = assertion({ predicate: 'participates_in_project', role: 'contractor', objectProjectId: 9, modality: 'planned' });
    const denied = assertion({ predicate: 'participates_in_project', role: 'general_contractor', objectProjectId: 10, polarity: 'negative' });
    const contract = assertion({ predicate: 'contract', role: 'subcontract', subjectCompanyId: 5, objectCompanyId: ME, valueNumeric: '70000000.00', valueCurrency: 'RUB', valueType: 'contract' });
    const s = computeCompanySignals(input([gc, vk, planned, denied, contract], [publication(1)]), CUTOFF);

    expect(s.experience.projects).toMatchObject({ value: 2, ids: [7, 8] });
    expect(Object.keys(s.experience.byRole).sort()).toEqual(['general_contractor', 'subcontractor']);
    expect(s.experience.byWorkPackage['ВК']?.ids).toEqual([8]);
    expect(s.experience.reviewed).toMatchObject({ value: 0.5, denominator: 2 });
    expect(s.experience.notCounted.map(n => n.assertionId).sort()).toEqual([planned.id, denied.id].sort());
    expect(s.experience.contracts).toEqual([expect.objectContaining({ side: 'performer', value: { amount: '70000000.00', currency: 'RUB', purpose: 'contract' } })]);
    expect(JSON.stringify(s.experience)).not.toMatch(/total|revenue|sum/i);
  });

  it('идентификация: неоднозначность важнее реквизита; реквизит без контрольной суммы — не подтверждён', () => {
    expect(computeCompanySignals(input([], [], { identifiers: [{ type: 'inn', validationStatus: 'checksum_valid' }] }), CUTOFF).identity.status).toBe('identified');
    expect(computeCompanySignals(input([], [], { identifiers: [{ type: 'inn', validationStatus: 'format_only' }] }), CUTOFF).identity.status).toBe('identifier_unverified');
    expect(computeCompanySignals(input([], [], { identifiers: [{ type: 'inn', validationStatus: 'checksum_valid' }], pendingMerges: 1 }), CUTOFF).identity.status).toBe('ambiguous');
  });
});

describe('TC-064: детерминизм на срезе', () => {
  it('одинаковый вход и срез — одинаковый снимок; порядок входа не важен; другой срез — другое окно', () => {
    const a = assertion({ validFrom: '2025-10-01', validTo: '2025-10-31', periodPrecision: 'month' }, [1, 2]);
    const pubs = [publication(2), publication(1)];
    const first = computeCompanySignals(input([a], pubs), CUTOFF);
    const second = computeCompanySignals(input([a], [...pubs].reverse()), CUTOFF);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const later = computeCompanySignals(input([a], pubs), new Date('2027-01-01T00:00:00Z'));
    expect(later.media.eventsDated12m.value).toBe(0);
    expect(first.media.eventsDated12m.value).toBe(1);
  });
});
