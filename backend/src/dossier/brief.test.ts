// Этап 17 без БД: краткое досье для переговоров на неприятных случаях — неизвестный заказчик, перепечатки, иск от и к
// компании, чужой объект, отклонённое отрицание, обрезанная выборка, новая редакция; одинаковый смысл в выгрузках.

import { describe, expect, it } from 'vitest';

import type { IRefreshState } from '../signals/refresh.js';
import { snapshotToHtml, snapshotToMarkdown, escapeHtml, escapeMarkdown, briefItemLine, type ISnapshotMeta } from '../snapshot/export.js';
import type { ISnapshotPayload } from '../snapshot/build.js';
import { buildNegotiationBrief, type IBriefItem, type INegotiationBrief } from './brief.js';
import { buildCaseDossier, type ICaseDossierInput } from './caseDossier.js';
import type { ICaseRow } from './cases.js';
import type { IFact } from './facts.js';

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
  claimedTerms: 'аванс 30% со слов',
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

let nextId = 500;
const fact = (over: Partial<IFact>, evidence: Array<{ quote: string; item?: number; hash?: string; publishedAt?: string; pending?: boolean }> = [{ quote: 'цитата' }]): IFact => {
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
    evidence: evidence.map((e, i) => ({
      id: nextId * 10 + i,
      stance: 'supports' as const,
      quote: e.quote,
      revisionId: nextId * 100 + i,
      sourceItemId: e.item ?? nextId * 100 + i,
      sourceTitle: 'Демо-канал',
      publishedAt: e.publishedAt ?? '2026-09-10T09:00:00Z',
      dedupHash: e.hash ?? `h${i}`,
      ...(e.pending ? { pendingRevision: true } : {}),
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

const brief = (over: Partial<ICaseDossierInput> = {}): INegotiationBrief => buildCaseDossier(input(over)).brief!;
const section = (b: INegotiationBrief, key: string): IBriefItem[] => b.sections.find(s => s.key === key)!.items;
const allText = (b: INegotiationBrief): string =>
  [...b.sections.flatMap(s => s.items), ...b.background.items].map(i => `${i.statusLabel} ${i.text} ${i.scope ?? ''} ${i.sources.label}`).concat(b.dataLimits, b.questions.map(q => q.text)).join('\n');

/** Формулировки, которых в досье быть не должно ни при каких данных. */
const FORBIDDEN = /ничего плохого|надёжн(ый|ая|ое|ость)\b(?! и не)|благонад|рекомендуем|можно (работать|сотрудничать)|риск-?(балл|рейтинг)|задолженность компании составляет|проверенный договор|подписанный договор подтвержд/i;

describe('структура вокруг вопроса обращения (T17-01)', () => {
  it('порядок разделов: юрлицо → объект → заявленная роль → основания → заказчик → условия → пробелы; фон отдельно', () => {
    const b = brief();
    expect(b.version).toBe('negotiation-brief@1');
    expect(b.sections.map(s => s.key)).toEqual(['identity', 'object', 'claimed_role', 'role_basis', 'direct_client', 'terms', 'contradictions_gaps']);
    expect(b.background.title).toMatch(/не события выбранной стройки/);
  });

  it('прямой договор неизвестен — «не установлен», цепочка не достраивается; заявленный заказчик — со слов', () => {
    const b = brief();
    const client = section(b, 'direct_client');
    expect(client.map(i => [i.code, i.status])).toEqual([
      ['claimed_client', 'operator_claim'],
      ['chain_not_documented', 'not_established'],
    ]);
    expect(client[1]!.text).toMatch(/не установлен.*не достраивается/);
    expect(b.questions.map(q => q.basedOn)).toContain('chain_not_documented');
  });

  it('условия со слов отделены от публикаций; суммы и аванс не предполагаются', () => {
    const terms = section(brief(), 'terms');
    expect(terms[0]).toMatchObject({ code: 'claimed_terms', statusLabel: 'со слов обратившегося' });
    expect(terms[1]).toMatchObject({ code: 'terms_absent', status: 'not_established' });
  });

  it('юрлицо не установлено — не подставляется одноимённый бренд; роль и заказчик не проверялись', () => {
    const b = brief({ caseRow: caseRow({ companyId: null, companyName: null, companyNameClaimed: 'Альфа', companyStatus: 'unidentified' }), identityStatus: null });
    expect(section(b, 'identity')[0]).toMatchObject({ code: 'company_unidentified', status: 'not_established' });
    expect(section(b, 'role_basis')[0]!.code).toBe('role_no_company');
    expect(allText(b)).not.toMatch(/Альфа-Демо/);
  });
});

describe('происхождение публикаций (T17-02)', () => {
  it('три перепечатки одного текста — одно подтверждение, не три', () => {
    const f = fact({}, [{ quote: 'Альфа-Демо — подрядчик корпуса 2', hash: 'same' }, { quote: 'Альфа-Демо — подрядчик корпуса 2', hash: 'same' }, { quote: 'Альфа-Демо — подрядчик корпуса 2', hash: 'same' }]);
    const item = section(brief({ companyFacts: [f] }), 'role_basis').find(i => i.code === 'role_established')!;
    expect(item.sources).toMatchObject({ publications: 3, textFamilies: 1, independence: 'reprints_of_one_text' });
    expect(item.sources.label).toMatch(/одно подтверждение/);
  });

  it('разные тексты с неизвестным первоисточником — независимость не доказана', () => {
    const f = fact({}, [{ quote: 'текст один', hash: 'a' }, { quote: 'текст два', hash: 'b' }]);
    const item = section(brief({ companyFacts: [f] }), 'role_basis').find(i => i.code === 'role_established')!;
    expect(item.sources.independence).toBe('different_texts_origin_unknown');
    expect(item.sources.label).toMatch(/независимость не доказана/);
    expect(item.sources.label).not.toMatch(/независимых подтвержд/);
  });
});

describe('события и общий фон (T17-03, T17-04)', () => {
  const lawsuit = (proceduralRole: string, counterpartyRole: string, over: Partial<IFact> = {}): IFact =>
    fact({
      predicate: 'event',
      role: null,
      eventType: 'court_case',
      objectProjectId: null,
      objectProjectName: null,
      scopeBuilding: null,
      workPackage: null,
      proceduralRole,
      counterpartyRole,
      counterpartyCompanyId: 77,
      counterpartyCompanyName: 'Гамма-Демо',
      caseNumber: 'А40-1/2026',
      validFrom: '2026-05-01',
      periodPrecision: 'day',
      valueNumeric: '1500000',
      valueCurrency: 'RUB',
      eventStage: 'accepted',
      ...over,
    });

  it('иск от компании и иск к компании — разные роли; сумма требований не названа задолженностью; это фон, не основание роли', () => {
    const asPlaintiff = lawsuit('plaintiff', 'defendant');
    const asDefendant = lawsuit('plaintiff', 'defendant', { subjectCompanyId: 77, subjectCompanyName: 'Гамма-Демо', counterpartyCompanyId: 10, counterpartyCompanyName: 'Альфа-Демо' });
    const b = brief({ companyFacts: [asPlaintiff, asDefendant] });
    const texts = b.background.items.map(i => i.text);
    expect(texts.some(t => /компания — истец/.test(t))).toBe(true);
    expect(texts.some(t => /компания — ответчик/.test(t))).toBe(true);
    expect(texts.every(t => /не установленная задолженность/.test(t))).toBe(true);
    expect(section(b, 'role_basis').some(i => i.code === 'company_event')).toBe(false);
    expect(allText(b)).not.toMatch(FORBIDDEN);
  });

  it('договор по другому объекту остаётся фоном с причиной; роль не наследуется', () => {
    const otherContract = fact({ predicate: 'contract', role: 'contractor', subjectCompanyId: 30, subjectCompanyName: 'Бета-Демо', objectCompanyId: 10, objectCompanyName: 'Альфа-Демо', objectProjectId: null, objectProjectName: null, contextProjectId: 99 });
    const b = brief({ companyFacts: [otherContract] });
    expect(b.background.items.find(i => i.code === 'contract_context')?.text).toMatch(/другому объекту/);
    expect(section(b, 'direct_client').some(i => i.code === 'contract_client')).toBe(false);
  });

  it('отклонённое аналитиком отрицание — в фоне со статусом, не среди противоречий', () => {
    const negative = fact({ polarity: 'negative', status: 'rejected' }, [{ quote: 'Альфа-Демо не подрядчик' }]);
    const b = brief({ companyFacts: [negative] });
    expect(section(b, 'contradictions_gaps').some(i => i.status === 'sources_contradict')).toBe(false);
    expect(b.background.items.find(i => i.code === 'role_denied_rejected')?.statusLabel).toBe('отклонено аналитиком');
  });
});

describe('основания, свежесть и ограничения данных (T17-05, T17-06)', () => {
  it('каждый вывод из утверждения открывается до доказательства; свежесть — дата публикации', () => {
    const b = brief({ companyFacts: [fact({ status: 'reviewed_supported' }, [{ quote: 'q', publishedAt: '2026-08-01T10:00:00Z' }, { quote: 'q2', publishedAt: '2026-09-01T10:00:00Z' }])] });
    const item = section(b, 'role_basis').find(i => i.code === 'role_established')!;
    expect(item).toMatchObject({ status: 'analyst_reviewed', statusLabel: 'проверено аналитиком', asOf: '2026-09-01', scope: 'в источнике не указано: роль, период' });
    expect(item.assertionIds).toHaveLength(1);
    expect(item.evidenceIds).toHaveLength(2);
    for (const i of [...b.sections.flatMap(s => s.items), ...b.background.items]) {
      if (i.assertionIds.length > 0) expect(i.evidenceIds.length, i.code).toBeGreaterThan(0);
    }
  });

  it('обрезанная выборка, невалидированная модель и новая редакция видны в резюме', () => {
    const b = brief({
      companyFacts: [fact({}, [{ quote: 'q', pending: true }])],
      coverage: [{ source: 'company_facts', limit: 1000, loaded: 1000, total: 1400, truncated: true }],
    });
    const limits = b.dataLimits.join('\n');
    expect(limits).toMatch(/Выборка ограничена: загружено 1000 из 1400/);
    expect(limits).toMatch(/LOCAL_MODEL_VALIDATED = нет/);
    expect(limits).toMatch(/более новая редакция/);
    expect(section(b, 'role_basis').find(i => i.code === 'role_established')!.pendingRevision).toBe(true);
  });

  it('нет сведений — «не установлено», а не «ничего плохого не найдено»', () => {
    const b = brief();
    expect(allText(b)).not.toMatch(FORBIDDEN);
    expect(b.background.empty).toMatch(/не означает, что их нет/);
  });
});

describe('выгрузки не расходятся по смыслу (T17-07)', () => {
  const meta: ISnapshotMeta = { id: 3, caseId: 1, payloadHash: 'abc', hashAlgorithm: 'sha256-canonical-json@1', generatedAt: '2026-09-15T12:00:00.000Z' };
  const payloadWith = (dossier: ReturnType<typeof buildCaseDossier>): ISnapshotPayload =>
    ({
      schemaVersion: 'dossier-snapshot@2',
      generatedAt: '2026-09-15T12:00:00.000Z',
      knowledgeCutoff: '2026-09-15T12:00:00.000Z',
      effective: { from: null, to: null, undatedIncluded: 0, excluded: 0, note: 'Фильтр дат не задан.' },
      versions: { template: dossier.templateVersion, signalsRules: 'signals@1', graph: 'graph@1', signalsCutoff: null, signalsStale: false },
      case: { id: 1, version: 1, title: 'ВК корпуса 2', companyStatus: 'identified', companyNameClaimed: null, projectNameClaimed: null, scopeBuilding: 'корпус 2', workPackage: 'ВК', workPackageLabel: null, claimedRole: 'contractor', claimedClientName: null, claimedTerms: null, requestDate: '2026-09-15', operatorNote: null, status: 'open', provenance: 'operator_recorded_claim' },
      company: { id: 10, name: 'Альфа-Демо', legalForm: 'ООО', entityType: 'legal_entity', identifiers: [] },
      claimedClient: null,
      project: { id: 20, name: 'Берег-Демо', level: 'complex', levelLabel: null, city: null },
      dossier,
      assertions: [],
      reviews: [],
      openQueue: [],
      sources: [],
      graph: { nodes: [], edges: [], truncated: false, notes: [] },
      selection: { assertionIds: [], evidenceIds: [], reviewIds: [] },
      limitations: [],
    }) as unknown as ISnapshotPayload;

  it('каждый пункт краткого досье — со статусом, текстом и основаниями в HTML и Markdown; JSON несёт тот же объект', () => {
    const dossier = buildCaseDossier(input({ companyFacts: [fact({}, [{ quote: 'q', hash: 'x' }, { quote: 'q', hash: 'x' }])] }));
    const p = payloadWith(dossier);
    const html = snapshotToHtml(meta, p);
    const md = snapshotToMarkdown(meta, p);
    const items = [...dossier.brief!.sections.flatMap(s => s.items), ...dossier.brief!.background.items];
    expect(items.length).toBeGreaterThan(5);
    for (const i of items) {
      const l = briefItemLine(i);
      expect(html, i.code).toContain(`<span class="attr">${escapeHtml(l.status)}</span> ${escapeHtml(l.text)}`);
      expect(md, i.code).toContain(`**${escapeMarkdown(l.status)}:** ${escapeMarkdown(l.text)}`);
      if (l.details) {
        expect(html).toContain(escapeHtml(l.details));
        expect(md).toContain(escapeMarkdown(l.details));
      }
    }
    for (const limit of dossier.brief!.dataLimits) {
      expect(html).toContain(escapeHtml(limit));
      expect(md).toContain(escapeMarkdown(limit));
    }
    expect(JSON.parse(JSON.stringify(p)).dossier.brief).toEqual(dossier.brief);
  });

  it('снимок до dossier-template@3 без краткого досье — честная пометка, а не пустой раздел', () => {
    const { brief: _b, ...old } = buildCaseDossier(input());
    const p = payloadWith({ ...old, templateVersion: 'dossier-template@2' });
    expect(snapshotToHtml(meta, p)).toContain('Краткое досье в снимке отсутствует');
    expect(snapshotToMarkdown(meta, p)).toContain('Краткое досье в снимке отсутствует');
  });

  it('buildNegotiationBrief детерминирован: одно досье — один результат', () => {
    const dossier = buildCaseDossier(input());
    expect(buildNegotiationBrief(dossier)).toEqual(buildNegotiationBrief(dossier));
  });
});
