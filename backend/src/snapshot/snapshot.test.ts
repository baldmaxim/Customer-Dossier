// Этап 08B без БД: каноническая сериализация и hash, экспорт без исполнения опасного текста,
// согласованность форматов, доступность и вымарывание, схема связей без транзитивных рёбер.

import { describe, it, expect } from 'vitest';

import { buildGraph, edgeMatches, edgeScopeNote, DEFAULT_FILTERS, type IGraphEdge, type IGraphLoader, type IGraphNode, type NodeKey } from '../graph/graph.js';
import type { ICaseDossier } from '../dossier/caseDossier.js';
import { applyAvailability, redactEvidence, REDACTED_QUOTE } from './availability.js';
import { withinEffective, type ISnapshotPayload } from './build.js';
import { canonicalJson, payloadHash } from './canonical.js';
import { escapeHtml, snapshotToHtml, snapshotToJson, snapshotToMarkdown, type ISnapshotMeta } from './export.js';

const EVIL = '<script>alert(1)</script><img src=x onerror=alert(2)> [ссылка](javascript:alert(3)) ![x](https://tracker.example/p.png)';

const dossier = (): ICaseDossier => ({
  templateVersion: 'dossier-template@1',
  caseId: 1,
  caseVersion: 1,
  generatedAt: '2026-09-15T12:00:00.000Z',
  freshness: { signalsCutoff: null, stale: false, staleReasons: [], latestEvidenceAt: null },
  subject: [],
  observations: [
    {
      code: 'role_established',
      text: 'В публикации сообщается: Альфа-Демо — подрядчик на объекте Берег-Демо.',
      attribution: 'source_reported',
      assertionIds: [10],
      evidenceIds: [100],
      quotes: [{ evidenceId: 100, quote: EVIL, sourceTitle: 'Канал <b>демо</b>', publishedAt: '2026-09-10T09:00:00Z', stance: 'supports' }],
    },
  ],
  role: { claimed: null, status: 'reported', established: [], otherBuildings: [], contradictions: [] },
  chain: { claimed: null, status: 'not_documented', documented: [], subcontracts: [], coParticipants: [] },
  terms: { claimed: null, fromSources: [] },
  projectContext: { state: [], events: [] },
  companyEvents: [],
  uncertainties: [],
  questions: [{ code: 'ask_chain_not_documented', text: 'Кто заказчик работ?', basedOn: 'chain_not_documented' }],
  disclaimer: 'Не решение о сотрудничестве.',
});

const payload = (): ISnapshotPayload => ({
  schemaVersion: 'dossier-snapshot@1',
  generatedAt: '2026-09-15T12:00:00.000Z',
  knowledgeCutoff: '2026-09-15T12:00:00.000Z',
  effective: { from: null, to: null, undatedIncluded: 0, excluded: 0, note: 'Фильтр дат не задан.' },
  versions: { template: 'dossier-template@1', signalsRules: 'signals@1', graph: 'graph@1', signalsCutoff: null, signalsStale: false },
  case: {
    id: 1,
    version: 1,
    title: 'ВК корпуса 2',
    companyStatus: 'identified',
    companyNameClaimed: null,
    projectNameClaimed: null,
    scopeBuilding: 'корпус 2',
    workPackage: 'ВК',
    workPackageLabel: null,
    claimedRole: 'contractor',
    claimedClientName: null,
    claimedTerms: '12000000.50',
    requestDate: '2026-09-15',
    operatorNote: null,
    status: 'open',
    provenance: 'operator_recorded_claim',
  },
  company: { id: 5, name: 'Альфа-Демо', legalForm: 'ООО', entityType: 'legal_entity', identifiers: ['inn 5001007329'] },
  claimedClient: null,
  project: { id: 7, name: 'Берег-Демо', level: 'complex', levelLabel: null, city: null },
  dossier: dossier(),
  assertions: [{ id: 10, version: 1, predicate: 'participates_in_project', role: 'contractor', eventType: null, status: 'text_grounded', needsRevalidation: false, polarity: 'positive', modality: 'reported_fact', supports: 1, contradicts: 0 }],
  reviews: [],
  openQueue: [],
  sources: [
    {
      evidenceId: 100,
      assertionId: 10,
      stance: 'supports',
      status: 'active',
      quote: EVIL,
      withheldReason: null,
      spanStart: 0,
      spanEnd: 10,
      revisionId: 55,
      revisionNo: 1,
      sourceItemId: 44,
      sourceId: 3,
      sourceKey: 'demo',
      sourceTitle: 'Канал <b>демо</b>',
      url: 'https://t.me/demo/1',
      publishedAt: '2026-09-10T09:00:00Z',
      completeness: 'full',
    },
  ],
  graph: { nodes: [], edges: [], truncated: false, notes: [] },
  selection: { assertionIds: [10], evidenceIds: [100], reviewIds: [] },
  limitations: ['Снимок фиксирует сведения на момент создания.'],
});

const meta: ISnapshotMeta = { id: 9, caseId: 1, payloadHash: 'abc123', hashAlgorithm: 'sha256-canonical-json@1', generatedAt: '2026-09-15T12:00:00.000Z' };

describe('каноническая сериализация и hash', () => {
  it('порядок ключей не влияет, изменение значения — влияет; hash устойчив к круговороту через JSON', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 'x', c: null }] })).toBe('{"a":[2,{"c":null,"d":"x"}],"b":1}');
    const p = payload();
    const roundTrip = JSON.parse(JSON.stringify(p)) as ISnapshotPayload;
    expect(payloadHash(roundTrip)).toBe(payloadHash(p));
    expect(payloadHash({ ...p, case: { ...p.case, title: 'другое' } })).not.toBe(payloadHash(p));
  });
});

describe('TC-072: экспорт без исполнения опасного текста', () => {
  it('HTML: без скриптов, обработчиков, внешних ресурсов; CSP запрещает всё, кроме встроенных стилей', () => {
    const html = snapshotToHtml(meta, payload());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    // Обработчик события в настоящем теге; экранированный текст «onerror=» внутри цитаты безопасен.
    expect(html).not.toMatch(/<[a-z][^>]*\son\w+=/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/src="https?:/i);
    expect(html).not.toMatch(/<link|@import|url\(/i);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('href="https://t.me/demo/1"');
    expect(escapeHtml('"\'<>&')).toBe('&quot;&#39;&lt;&gt;&amp;');
  });

  it('HTML: длинные строки без пробелов (hash, адрес) переносятся — печать и 390 px без выхода за ширину (C1, T18-04)', () => {
    const html = snapshotToHtml(meta, payload());
    expect(html).toMatch(/body\{[^}]*overflow-wrap:anywhere/);
  });

  it('Markdown: ссылки и картинки из текста источника не становятся активными, сырой HTML экранирован', () => {
    const md = snapshotToMarkdown(meta, payload());
    expect(md).not.toMatch(/\]\(javascript:/);
    expect(md).not.toMatch(/!\[x\]\(https/);
    expect(md).not.toContain('<script>');
    expect(md).toContain('&lt;script');
    expect(md).toContain('<https://t.me/demo/1>');
  });

  it('JSON: схема экспорта, суммы строками, без технического контекста', () => {
    const json = JSON.parse(snapshotToJson(meta, payload(), { withheldSources: [] })) as Record<string, unknown>;
    expect(json.exportSchema).toBe('dossier-snapshot-export@1');
    expect((json.payload as ISnapshotPayload).case.claimedTerms).toBe('12000000.50');
    expect(JSON.stringify(json)).not.toMatch(/token|password|stack|DATABASE_URL|LMSTUDIO/i);
  });

  it('опасный URL источника (javascript:/data:/vbscript:/file:, регистр, пробелы, кавычки) не становится ссылкой ни в HTML, ни в Markdown', () => {
    const urls = [
      'javascript:alert(1)',
      ' JaVaScRiPt:alert(2)',
      'data:text/html,<script>alert(3)</script>',
      'vbscript:msgbox(4)',
      'file:///etc/passwd',
      'https://t.me/demo/1"><script>alert(5)</script>',
      "https://t.me/demo/1' onmouseover='alert(6)",
    ];
    for (const url of urls) {
      const p = payload();
      p.sources = p.sources.map(s => ({ ...s, url }));
      const html = snapshotToHtml(meta, p);
      const md = snapshotToMarkdown(meta, p);
      expect(html).not.toMatch(/href="\s*(javascript|data|vbscript|file):/i);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<[a-z][^>]*\son\w+=/i);
      expect(md).not.toMatch(/<\s*(javascript|data|vbscript|file):/i);
      expect(md).not.toMatch(/\]\(\s*(javascript|data|vbscript|file):/i);
      expect(md).not.toContain('<script>');
      // Ссылка в HTML — только http(s) и только с экранированными кавычками внутри атрибута.
      for (const m of html.matchAll(/href="([^"]*)"/g)) expect(m[1]).toMatch(/^https?:\/\/[^"<>]*$/);
    }
  });

  it('форматы согласованы по существенному содержанию', () => {
    const html = snapshotToHtml(meta, payload());
    const md = snapshotToMarkdown(meta, payload());
    const json = snapshotToJson(meta, payload(), {});
    for (const text of ['ВК корпуса 2', 'Альфа-Демо', 'Кто заказчик работ', 'abc123']) {
      expect(html).toContain(text);
      expect(md.replace(/\\/g, '')).toContain(text);
      expect(json).toContain(text);
    }
  });
});

describe('TC-073: доступность и вымарывание', () => {
  it('отозванный источник: цитаты скрыты в копии для выдачи, хранимый payload и его hash не меняются', () => {
    const stored = payload();
    const before = payloadHash(stored);
    const shown = applyAvailability(stored, { checkedAt: 'now', withheldSources: [{ sourceId: 3, sourceKey: 'demo', reason: 'допуск отозван' }], withheldEvidence: 1 });
    expect(shown.sources[0]).toMatchObject({ quote: null, withheldReason: 'Скрыто при выдаче: допуск отозван' });
    expect(shown.dossier.observations[0]!.quotes).toEqual([]);
    expect(shown.limitations.at(-1)).toContain('Hash относится к хранимому содержанию');
    expect(payloadHash(stored)).toBe(before);
    expect(snapshotToHtml(meta, shown)).not.toContain('alert(1)');
  });

  it('вымарывание заменяет цитату везде и меняет hash; неизвестный фрагмент — не найден', () => {
    const { payload: redacted, found } = redactEvidence(payload(), 100);
    expect(found).toBe(true);
    expect(redacted.sources[0]!.quote).toBe(REDACTED_QUOTE);
    expect(redacted.dossier.observations[0]!.quotes[0]!.quote).toBe(REDACTED_QUOTE);
    expect(payloadHash(redacted)).not.toBe(payloadHash(payload()));
    expect(redactEvidence(payload(), 999).found).toBe(false);
  });

  it('фильтр дат: вне периода исключается, без даты включается отдельно', () => {
    expect(withinEffective({ validFrom: '2024-01-01', validTo: '2024-12-31' }, '2026-01-01', '2026-12-31')).toBe('out');
    expect(withinEffective({ validFrom: null, validTo: null }, '2026-01-01', null)).toBe('undated');
    expect(withinEffective({ validFrom: '2026-06-01', validTo: null }, '2026-01-01', '2026-12-31')).toBe('in');
    expect(withinEffective({ validFrom: '2020-01-01', validTo: null }, null, null)).toBe('in');
  });
});

describe('TC-069: схема связей', () => {
  const edge = (over: Partial<IGraphEdge> & Pick<IGraphEdge, 'key' | 'from' | 'to'>): IGraphEdge => ({
    type: 'contract',
    assertionId: Number(over.key.replace(/\D/g, '')) || null,
    role: 'subcontract',
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
  // Цепочка A→B→C и цикл C→A: транзитивного ребра A→C нет, обход не зацикливается.
  const all: IGraphEdge[] = [
    edge({ key: 'a:1', from: 'c:1', to: 'c:2', role: 'general_contract' }),
    edge({ key: 'a:2', from: 'c:2', to: 'c:3', role: 'subcontract', building: 'корпус 2', workPackage: 'ВК', validFrom: '2026-06-01', periodPrecision: 'month' }),
    edge({ key: 'a:3', from: 'c:3', to: 'c:1', type: 'corporate', role: 'member_of_group' }),
    edge({ key: 'a:4', from: 'c:1', to: 'p:9', type: 'participation', role: 'customer', modality: 'planned' }),
  ];
  const loader: IGraphLoader = {
    edges: async keys => all.filter(e => keys.includes(e.from) || keys.includes(e.to)),
    nodes: async keys => keys.map(k => ({ key: k as NodeKey, kind: k.startsWith('c:') ? 'company' : 'project', id: Number(k.slice(2)), label: k, subtype: null, details: [], depth: 0, seed: false }) as IGraphNode),
  };

  it('цепочка без транзитивного договора, цикл не зацикливает, у ребра корпус, работы и период', async () => {
    const g = await buildGraph(['c:1'], { depth: 3 }, loader);
    expect(g.edges.map(e => e.key).sort()).toEqual(['a:1', 'a:2', 'a:3']);
    expect(g.edges.some(e => e.from === 'c:1' && e.to === 'c:3' && e.type === 'contract')).toBe(false);
    expect(g.nodes.map(n => n.key).sort()).toEqual(['c:1', 'c:2', 'c:3']);
    expect(g.edges.find(e => e.key === 'a:2')).toMatchObject({ building: 'корпус 2', workPackage: 'ВК', validFrom: '2026-06-01', assertionId: 2 });
  });

  it('план скрыт по умолчанию и показывается по фильтру; лимит узлов помечает усечение', async () => {
    const withPlans = await buildGraph(['c:1'], { depth: 1, includeUnconfirmed: true }, loader);
    expect(withPlans.edges.map(e => e.key)).toContain('a:4');
    const limited = await buildGraph(['c:1'], { depth: 3, limit: 2 }, loader);
    expect(limited.nodes).toHaveLength(2);
    expect(limited.truncated).toBe(true);
    expect(limited.notes.join(' ')).toContain('лимит');
  });

  it('фильтры: только проверенные, период, совместное упоминание по умолчанию скрыто', () => {
    const e = all[1]!;
    expect(edgeMatches(e, { ...DEFAULT_FILTERS, reviewedOnly: true })).toBe(false);
    expect(edgeMatches(e, { ...DEFAULT_FILTERS, from: '2025-01-01', to: '2025-12-31' })).toBe(false);
    expect(edgeMatches(e, { ...DEFAULT_FILTERS, from: '2026-01-01', to: '2026-12-31' })).toBe(true);
    expect(edgeMatches({ ...e, type: 'co_mentioned' }, DEFAULT_FILTERS)).toBe(false);
  });
});

describe('этап 12: схема связей по тому же правилу области', () => {
  const edge = (over: Partial<IGraphEdge>): IGraphEdge => ({
    key: 'e', type: 'participation', from: 'c:1', to: 'p:2', assertionId: 1, role: 'contractor', building: null, workPackage: null,
    validFrom: null, validTo: null, periodPrecision: 'unknown', status: 'text_grounded', polarity: 'positive', modality: 'reported_fact',
    supports: 1, contradicts: 0, contextProjectId: null, details: [], ...over,
  });
  it('другой корпус скрыт с учётом записи «корп. № 2»; неуказанный корпус остаётся с пометкой', () => {
    const filters = { ...DEFAULT_FILTERS, building: 'корпус 2' };
    expect(edgeMatches(edge({ building: 'Корп. № 2' }), filters)).toBe(true);
    expect(edgeMatches(edge({ building: 'корпус 1' }), filters)).toBe(false);
    expect(edgeMatches(edge({ building: null }), filters)).toBe(true);
    expect(edgeScopeNote(edge({ building: null }), filters)).toContain('корпус в источнике не указан');
    expect(edgeScopeNote(edge({ building: 'корпус 2' }), filters)).toBeNull();
  });
});
