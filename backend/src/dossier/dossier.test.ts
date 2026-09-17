// Этап 08A без БД: шаблоны досье обращения и правила ввода обращения. Данные синтетические.

import { describe, it, expect } from 'vitest';

import { reviewSchema } from '../api/assertions.routes.js';
import type { IRefreshState } from '../signals/refresh.js';
import { buildCaseDossier, type ICaseDossierInput } from './caseDossier.js';
import { createCaseSchema, updateCaseSchema, type ICaseRow } from './cases.js';
import type { IFact } from './facts.js';
import { dateText } from './statements.js';

const refresh: IRefreshState = {
  active: { id: 1, rulesVersion: 'signals@1', cutoffAt: '2026-09-15T12:00:00.000Z', finishedAt: '2026-09-15T12:00:01.000Z' },
  lastFailure: null,
  running: false,
  stale: false,
  staleReasons: [],
};

const caseRow = (over: Partial<ICaseRow> = {}): ICaseRow => ({
  id: 1,
  title: 'ВК корпуса 2',
  companyStatus: 'identified',
  companyId: 10,
  companyName: 'Альфа-Демо',
  companyNameClaimed: null,
  projectId: 20,
  projectName: 'Берег-Демо',
  projectNameClaimed: null,
  scopeBuilding: 'корпус 2',
  workPackage: 'ВК',
  workPackageLabel: 'системы ВК',
  claimedRole: 'contractor',
  claimedClientCompanyId: 30,
  claimedClientCompanyName: 'Бета-Демо',
  claimedClientName: null,
  claimedTerms: null,
  requestDate: '2026-09-15',
  operatorNote: null,
  status: 'open',
  provenance: 'operator_recorded_claim',
  version: 1,
  createdBy: 'operator',
  createdAt: '2026-09-15T12:00:00Z',
  updatedAt: '2026-09-15T12:00:00Z',
  ...over,
});

let nextId = 100;
const fact = (over: Partial<IFact>, quotes: string[] = ['цитата']): IFact => {
  nextId += 1;
  return {
    assertionId: nextId,
    version: 1,
    predicate: 'participates_in_project',
    role: 'contractor',
    eventType: null,
    status: 'text_grounded',
    origin: 'extraction',
    needsRevalidation: false,
    polarity: 'positive',
    modality: 'reported_fact',
    subjectCompanyId: 10,
    subjectCompanyName: 'Альфа-Демо',
    subjectProjectId: null,
    objectCompanyId: null,
    objectCompanyName: null,
    objectProjectId: 20,
    objectProjectName: 'Берег-Демо',
    counterpartyCompanyId: null,
    counterpartyCompanyName: null,
    contextProjectId: null,
    scopeBuilding: 'корпус 2',
    workPackage: 'ВК',
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
    attributedTo: null,
    evidence: quotes.map((quote, i) => ({
      id: nextId * 10 + i,
      stance: 'supports' as const,
      quote,
      revisionId: nextId * 100 + i,
      sourceItemId: nextId * 100 + i,
      sourceTitle: 'Демо-канал',
      publishedAt: '2026-09-10T09:00:00Z',
      dedupHash: 'h',
    })),
    priorDecisions: [],
    ...over,
  };
};

const input = (over: Partial<ICaseDossierInput> = {}): ICaseDossierInput => ({
  caseRow: caseRow(),
  generatedAt: '2026-09-15T12:00:00.000Z',
  refresh,
  identityStatus: 'identified',
  homonyms: [],
  companyFacts: [],
  projectFacts: [],
  projectState: [],
  openQueue: [],
  ...over,
});

const codes = (items: Array<{ code: string }>): string[] => items.map(i => i.code).sort();

describe('обращение: заявленное отдельно от установленного', () => {
  it('роль из проверенного утверждения — «аналитиком проверено», с id утверждения и цитатой; заявленная роль — запись оператора', () => {
    const reviewed = fact({ status: 'reviewed_supported' }, ['«Альфа-Демо» выполняет ВК корпуса 2 ЖК «Берег-Демо»']);
    const d = buildCaseDossier(input({ companyFacts: [reviewed] }));
    expect(d.role.status).toBe('reviewed');
    expect(d.role.claimed).toMatchObject({ attribution: 'operator_claim', assertionIds: [] });
    expect(d.role.established[0]).toMatchObject({ attribution: 'analyst_reviewed', assertionIds: [reviewed.assertionId], evidenceIds: [reviewed.evidence[0]!.id] });
    expect(d.role.established[0]!.text).toMatch(/^Аналитиком проверено/);
    expect(d.observations[0]!.assertionIds).toEqual([reviewed.assertionId]);
  });

  it('решение до слияния видно через линию слияния, но не переносится: атрибуция остаётся «в публикации сообщается»', () => {
    const prior = { assertionId: 7, mergeId: 3, decisionId: 41, decision: 'reviewed_supported', reviewer: 'analyst', decidedAt: '2026-09-14T08:00:00Z' };
    const merged = fact({ status: 'text_grounded', priorDecisions: [prior] }, ['«Альфа-Демо» выполняет ВК корпуса 2 ЖК «Берег-Демо»']);
    const d = buildCaseDossier(input({ companyFacts: [merged] }));
    const statement = d.role.established[0]!;
    expect(statement.attribution).toBe('source_reported');
    expect(statement.assertionIds).toEqual([merged.assertionId]);
    expect(statement.priorDecisions).toEqual([prior]);
    expect(statement.text).toContain('#7 — проверено (analyst, 2026-09-14, слияние #3)');
    expect(statement.text).toContain('нужен пересмотр');
    expect(d.role.status).not.toBe('reviewed');

    // Утверждение без слияния: поля нет, фраза прежняя.
    const plain = buildCaseDossier(input({ companyFacts: [fact({})] })).role.established[0]!;
    expect(plain).not.toHaveProperty('priorDecisions');
    expect(plain.text).not.toContain('слияни');
  });

  it('ничего не найдено — «не установлено в выборке» и вопросы по пробелам, а не выдуманные проблемы', () => {
    const d = buildCaseDossier(input());
    expect(d.role.status).toBe('not_established');
    expect(d.chain.status).toBe('not_documented');
    expect(d.observations).toEqual([expect.objectContaining({ code: 'nothing_found', attribution: 'not_established' })]);
    expect(codes(d.questions)).toEqual(['ask_chain_not_documented', 'ask_role_not_established', 'ask_terms_not_in_sources']);
    expect(d.questions.find(q => q.code === 'ask_court_cases_present')).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/аванс \d|%/);
  });

  it('отрицание заявленной роли — противоречие наверху и вопрос о нём; совместное участие — не договор', () => {
    // С этапа 12 отрицание другой роли заявленную роль не опровергает (T12-10) — здесь отрицается заявленная.
    const denied = fact({ polarity: 'negative', role: 'contractor' });
    const other = fact({ subjectCompanyId: 30, subjectCompanyName: 'Бета-Демо', role: 'general_contractor' });
    const d = buildCaseDossier(input({ companyFacts: [denied], projectFacts: [other] }));
    expect(d.role.status).toBe('contradicted');
    expect(d.observations[0]).toMatchObject({ code: 'role_denied', assertionIds: [denied.assertionId] });
    expect(d.questions.map(q => q.code)).toContain('ask_role_contradicted');
    expect(d.chain.coParticipants[0]!.text).toContain('договор между компаниями этим не установлен');
    expect(d.chain.documented).toEqual([]);
  });

  it('договор с другим заказчиком, чем заявлено — вопрос о цепочке; сумма только из источника', () => {
    const contract = fact({ predicate: 'contract', role: 'subcontract', subjectCompanyId: 40, subjectCompanyName: 'Гамма-Демо', objectCompanyId: 10, objectCompanyName: 'Альфа-Демо', contextProjectId: 20, valueNumeric: '70000000.00', valueCurrency: 'RUB', valueType: 'contract' });
    const d = buildCaseDossier(input({ companyFacts: [contract] }));
    expect(d.chain.status).toBe('differs_from_claim');
    expect(d.questions.map(q => q.code)).toContain('ask_chain_differs');
    expect(d.terms.fromSources[0]!.text).toContain('70000000.00 RUB');
    expect(d.questions.map(q => q.code)).not.toContain('ask_terms_not_in_sources');
  });

  it('юрлицо не установлено: одноимённые показаны для выбора, факты компании не подставляются', () => {
    const d = buildCaseDossier(
      input({
        caseRow: caseRow({ companyStatus: 'unidentified', companyId: null, companyName: null, companyNameClaimed: 'Альфа-Демо' }),
        homonyms: [
          { id: 10, name: 'Альфа-Демо', entityType: 'legal_entity', legalForm: 'ООО', city: null, identifiers: ['inn 5001007329'] },
          { id: 11, name: 'Альфа-Демо', entityType: 'legal_entity', legalForm: 'АО', city: null, identifiers: ['inn 7700000016'] },
        ],
      }),
    );
    expect(d.subject[0]).toMatchObject({ code: 'company_unidentified', attribution: 'not_established' });
    expect(d.subject[1]!.text).toContain('не смешиваются');
    expect(d.role.status).toBe('no_company');
    expect(d.questions[0]).toMatchObject({ code: 'ask_company_unidentified' });
  });

  it('событие объекта до участия компании — контекст «вне периода участия», не ответственность', () => {
    const joined = fact({ validFrom: '2026-06-01', periodPrecision: 'month' });
    const delay = fact({ predicate: 'event', eventType: 'delay', subjectCompanyId: null, subjectCompanyName: null, subjectProjectId: 20, objectProjectId: null, scopeBuilding: 'корпус 1', validFrom: '2024-01-01', validTo: '2024-12-31', periodPrecision: 'year' });
    const d = buildCaseDossier(input({ companyFacts: [joined], projectFacts: [delay] }));
    expect(d.projectContext.events[0]!.text).toContain('вне периода участия компании');
    expect(d.projectContext.events[0]!.text).toContain('относится к корпус 1');
    expect(d.observations.map(o => o.code)).not.toContain('project_event');
  });

  it('суд, где компания истец: наблюдение с ролью и оговоркой, вопрос только если дело есть', () => {
    const court = fact({ predicate: 'event', eventType: 'court_case', proceduralRole: 'plaintiff', counterpartyCompanyId: 30, counterpartyCompanyName: 'Бета-Демо', objectProjectId: null });
    const d = buildCaseDossier(input({ companyFacts: [court] }));
    expect(d.companyEvents[0]!.text).toContain('компания — истец');
    expect(d.companyEvents[0]!.text).toContain('не означает нарушения');
    expect(d.observations.map(o => o.code)).toContain('company_event');
    expect(d.questions.map(q => q.code)).toContain('ask_court_cases_present');
  });

  it('устаревшие сигналы и открытые противоречия — в неопределённостях', () => {
    const d = buildCaseDossier(
      input({ refresh: { ...refresh, stale: true, staleReasons: ['последний пересчёт завершился ошибкой'] }, openQueue: [{ kind: 'dispute', assertionId: 1, priority: 4 }] }),
    );
    expect(codes(d.uncertainties)).toEqual(expect.arrayContaining(['review_pending', 'signals_stale']));
    expect(d.freshness).toMatchObject({ stale: true, signalsCutoff: '2026-09-15T12:00:00.000Z' });
  });

  it('детерминизм: один вход — одно досье', () => {
    const f = fact({});
    expect(JSON.stringify(buildCaseDossier(input({ companyFacts: [f] })))).toBe(JSON.stringify(buildCaseDossier(input({ companyFacts: [f] }))));
  });
});

describe('ввод обращения и решения', () => {
  it('юрлицо выбрано или явно не установлено с названием; иначе ошибка', () => {
    const base = { title: 'Обращение', requestDate: '2026-09-15' };
    expect(createCaseSchema.safeParse({ ...base, companyId: 10 }).success).toBe(true);
    expect(createCaseSchema.safeParse({ ...base, companyNameClaimed: 'Альфа-Демо' }).success).toBe(true);
    expect(createCaseSchema.safeParse(base).success).toBe(false);
    expect(updateCaseSchema.safeParse({ ...base, companyId: 10 }).success).toBe(false);
    expect(createCaseSchema.safeParse({ ...base, companyId: 10, claimedRole: 'владелец' }).success).toBe(false);
  });

  it('причина обязательна для отклонения, спора и возврата на проверку', () => {
    const base = { expectedVersion: 1, idempotencyKey: 'key-00000001' };
    expect(reviewSchema.safeParse({ ...base, decision: 'reviewed_supported' }).success).toBe(true);
    expect(reviewSchema.safeParse({ ...base, decision: 'disputed' }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...base, decision: 'rejected', reason: 'нет' }).success).toBe(true);
    expect(reviewSchema.safeParse({ ...base, decision: 'candidate', reason: ' ' }).success).toBe(false);
  });

  it('дата с точностью текста', () => {
    expect(dateText('2026-06-01', 'month')).toBe('июнь 2026');
    expect(dateText('2026-03-12', 'day')).toBe('12 марта 2026');
    expect(dateText('2024-01-01', 'year')).toBe('2024 год');
    expect(dateText(null, 'unknown')).toBe('дата не указана');
  });
});

// ---------------------------------------------------------------------------
// Этап 12: применимость по предмету обращения (scope-match@1). Обращение: объект 20, корпус 2, работы ВК,
// заявлена роль подрядчика, дата обращения 2026-09-15. R01–R05 — исходные ошибки аудита, C01 — положительный контроль.

describe('этап 12: область роли и договорной цепочки', () => {
  const contract = (over: Partial<IFact>): IFact =>
    fact({ predicate: 'contract', role: 'subcontract', subjectCompanyId: 30, subjectCompanyName: 'Бета-Демо', objectCompanyId: 10, objectCompanyName: 'Альфа-Демо', contextProjectId: 20, ...over });

  it('R01 / T12-01: договор без объекта — общий фон отношений, а не documented по выбранной стройке', () => {
    const d = buildCaseDossier(input({ companyFacts: [contract({ contextProjectId: null })] }));
    expect(d.chain.status).toBe('scope_unknown');
    expect(d.chain.documented).toEqual([]);
    expect(d.chain.context![0]!.text).toContain('объект договора в публикации не назван');
    expect(d.questions.map(q => q.code)).toContain('ask_chain_not_documented');
  });

  it('R02 / T12-02: отрицание по корпусу 1 не опровергает корпус 2', () => {
    const positive = fact({});
    const denied = fact({ polarity: 'negative', scopeBuilding: 'корпус 1' });
    const d = buildCaseDossier(input({ companyFacts: [positive, denied] }));
    expect(d.role.status).toBe('reported');
    expect(d.role.contradictions).toEqual([]);
    expect(d.role.context!.map(s => s.code)).toContain('role_denied_other_scope');
  });

  it('R03 / T12-03: отклонённое аналитиком отрицание видно в истории, но не определяет статус', () => {
    const d = buildCaseDossier(input({ companyFacts: [fact({}), fact({ polarity: 'negative', status: 'rejected' })] }));
    expect(d.role.status).toBe('reported');
    expect(d.role.contradictions).toEqual([]);
    expect(d.role.context!.find(s => s.code === 'role_denied_rejected')!.text).toContain('отклонено аналитиком');
  });

  it('R04 / T12-04: участие без корпуса при выбранном корпусе — контекст объекта, не established', () => {
    const d = buildCaseDossier(input({ companyFacts: [fact({ scopeBuilding: null })] }));
    expect(d.role.established).toEqual([]);
    expect(d.role.status).toBe('scope_unknown');
    const ctx = d.role.context!.find(s => s.code === 'role_project_level')!;
    expect(ctx.scope!.missing).toContain('building');
    expect(ctx.text).toContain('в источнике не указано: корпус');
    expect(d.questions.map(q => q.code)).toContain('ask_role_scope_unknown');
  });

  it('R05 / T12-05: договор на другой корпус или другие работы того же объекта не подтверждает цепочку', () => {
    const otherBuilding = buildCaseDossier(input({ companyFacts: [contract({ scopeBuilding: 'корпус 1' })] }));
    expect(otherBuilding.chain.documented).toEqual([]);
    expect(otherBuilding.chain.status).toBe('scope_unknown');
    const otherWork = buildCaseDossier(input({ companyFacts: [contract({ workPackage: 'ЭОМ' })] }));
    expect(otherWork.chain.documented).toEqual([]);
    expect(otherWork.chain.context![0]!.scope!.conflicts).toEqual(['work']);
    // сумма из неприменимого договора в условия обращения не попадает
    const priced = buildCaseDossier(input({ companyFacts: [contract({ workPackage: 'ЭОМ', valueNumeric: '5000000.00', valueCurrency: 'RUB' })] }));
    expect(priced.terms.fromSources).toEqual([]);
  });

  it('C01 / T12-06: участие на явно другом корпусе по-прежнему отдельно', () => {
    const d = buildCaseDossier(input({ companyFacts: [fact({ scopeBuilding: 'корпус 1' })] }));
    expect(d.role.otherBuildings).toHaveLength(1);
    expect(d.role.established).toEqual([]);
    expect(d.role.status).toBe('not_established');
  });

  it('документированный договор по объекту, корпусу и работам — documented с источником', () => {
    const d = buildCaseDossier(input({ caseRow: caseRow({ claimedClientCompanyId: 30 }), companyFacts: [contract({ scopeBuilding: 'Корп. № 2' })] }));
    expect(d.chain.status).toBe('documented');
    expect(d.chain.documented[0]!.scope!.dimensions).toMatchObject({ project: 'match', building: 'match', work: 'match' });
  });

  it('T12-07: последовательная смена подрядчика — закончившееся участие не текущая роль и не конфликт', () => {
    const ended = fact({ validFrom: '2025-03-01', validTo: '2026-03-31', periodPrecision: 'month' });
    const d = buildCaseDossier(input({ companyFacts: [ended] }));
    expect(d.role.established).toEqual([]);
    expect(d.role.contradictions).toEqual([]);
    expect(d.role.context!.find(s => s.code === 'role_other_scope')!.text).toContain('другому периоду');
    const current = buildCaseDossier(input({ companyFacts: [fact({ validFrom: '2026-04-01', periodPrecision: 'month' })] }));
    expect(current.role.established[0]!.scope!.dimensions.period).toBe('match');
  });

  it('T12-08: план стать подрядчиком не участие; отрицание плана не отрицание участия', () => {
    const plan = fact({ modality: 'planned' });
    expect(buildCaseDossier(input({ companyFacts: [plan] })).role.established).toEqual([]);
    const negPlan = fact({ polarity: 'negative', modality: 'planned' });
    const d = buildCaseDossier(input({ companyFacts: [fact({}), negPlan] }));
    // отрицательная модальность «план» проходит как отрицание — но только если применима; здесь это отрицание плана
    expect(d.role.established).toHaveLength(1);
  });

  it('T12-09: null корпуса не означает «весь объект» — корпус из него не выводится', () => {
    const d = buildCaseDossier(input({ companyFacts: [fact({ scopeBuilding: null, workPackage: null })] }));
    expect(d.role.established).toEqual([]);
  });

  it('T12-10: отрицание роли генподрядчика не опровергает заявленную роль подрядчика', () => {
    const d = buildCaseDossier(input({ companyFacts: [fact({}), fact({ polarity: 'negative', role: 'general_contractor' })] }));
    expect(d.role.status).toBe('reported');
    expect(d.role.contradictions).toEqual([]);
    expect(d.role.context!.find(s => s.code === 'role_denied_other_scope')!.scope!.conflicts).toContain('role');
  });

  it('T12-11: применимое неотклонённое отрицание сохраняется рядом с решением аналитика', () => {
    const d = buildCaseDossier(input({ companyFacts: [fact({ status: 'reviewed_supported' }), fact({ polarity: 'negative' })] }));
    expect(d.role.status).toBe('contradicted');
    expect(d.role.established[0]!.attribution).toBe('analyst_reviewed');
    expect(d.role.contradictions[0]!.code).toBe('role_denied');
  });

  it('отрицание по объекту без корпуса — противоречие с пометкой «корпус не указан» и вопросом, а не молчаливое подтверждение', () => {
    const d = buildCaseDossier(input({ companyFacts: [fact({}), fact({ polarity: 'negative', scopeBuilding: null })] }));
    expect(d.role.status).toBe('contradicted');
    expect(d.role.contradictions[0]!.scope!.missing).toContain('building');
    expect(d.role.contradictions[0]!.text).toContain('в источнике не указано: корпус');
    expect(d.questions.map(q => q.code)).toContain('ask_contradiction_scope_unknown');
  });
});
