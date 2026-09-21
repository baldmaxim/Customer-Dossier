// Правила signals@2: чистая детерминированная функция входа и среза. Никаких весов, шкал и вердиктов.
//
// signals@2 добавил числа, которые раньше были только списками: договоры, корпоративные связи,
// названные контрагенты, события по видам, число судебных дел и края выборки по датам публикаций.
// Правила прежних чисел не менялись; новое число — новая версия, а не тихая правка.
//
// Разделение, которое нельзя сливать в одно число:
//  - идентификация и полнота выборки;
//  - опыт: объект, корпус, роль, пакет работ, период — без сумм и «выручки»;
//  - публикации, наблюдения, семьи происхождения и события: пять перепечаток — пять публикаций,
//    одна семья и одно событие; неизвестное происхождение не считается независимым;
//  - суды по процессуальной роли и стадии: истец не нарушитель, результат — только по тексту.
// Каждое проверенное аналитиком отделено от «есть в тексте»; отклонённое и спорное видно, но не reviewed.

import { aggregate, dateStatus, share, windowDays, windowMonths } from './intervals.js';
import {
  SIGNAL_RULES_VERSION,
  type ICompanySignalInput,
  type ICompanySignals,
  type IDateSignal,
  type IEventItem,
  type IExperienceBlock,
  type IIdentityBlock,
  type ILegalCase,
  type IMediaBlock,
  type ISignalAssertion,
  type ISignalPublication,
  type ReviewLevel,
} from './types.js';

const FACT_MODALITIES = new Set(['reported_fact', 'unknown']);
const EVENT_MODALITIES = new Set(['reported_fact', 'claim', 'unknown']);
const COURT_TYPES = new Set(['court_case', 'bankruptcy', 'bankruptcy_intent', 'bankruptcy_filing', 'bankruptcy_procedure', 'payment_claim']);

export const reviewLevel = (a: Pick<ISignalAssertion, 'status' | 'origin'>): ReviewLevel => {
  if (a.status === 'rejected') return 'rejected';
  if (a.status === 'disputed') return 'disputed';
  if (a.status === 'reviewed_supported') return 'reviewed';
  return a.origin === 'legacy_import' ? 'legacy_unreviewed' : 'text_grounded';
};

const supports = (a: ISignalAssertion): boolean => a.evidence.some(e => e.stance === 'supports');
const itemsOf = (a: ISignalAssertion): number[] => [...new Set(a.evidence.filter(e => e.stance === 'supports').map(e => e.sourceItemId))];
const valueOf = (a: ISignalAssertion) => (a.valueNumeric ? { amount: a.valueNumeric, currency: a.valueCurrency, purpose: a.valueType } : null);

// ---------------------------------------------------------------------------
// Семьи происхождения

export type OriginStatus = 'established' | 'named' | 'unknown';

export interface IOriginFamily {
  key: string;
  members: number[];
  origin: OriginStatus;
}

const norm = (s: string): string => s.trim().replace(/^@/, '').toLowerCase();

/**
 * Семья — публикации с одинаковым текстом (хэш дедупликации): признак общей семьи, не доказательство первоисточника.
 *  - established: в семье есть непересланная публикация того самого источника, на который ссылаются пересылки;
 *  - named: пересылки называют источник, но его публикации в выборке нет;
 *  - unknown: только совпадение текста или одна публикация — первоисточник не установлен.
 */
export const originFamilies = (publications: readonly ISignalPublication[]): IOriginFamily[] => {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const union = (a: number, b: number): void => {
    parent.set(find(a), find(b));
  };
  for (const p of publications) parent.set(p.sourceItemId, p.sourceItemId);

  // Только общий текст объединяет публикации в семью: источник пересылки назван на уровне канала,
  // а у канала много разных постов — по одному имени канала посты не склеиваются.
  const byHash = new Map<string, number>();
  for (const p of publications) {
    const prior = byHash.get(p.dedupHash);
    if (prior !== undefined) union(p.sourceItemId, prior);
    else byHash.set(p.dedupHash, p.sourceItemId);
  }

  const groups = new Map<number, ISignalPublication[]>();
  for (const p of publications) groups.set(find(p.sourceItemId), [...(groups.get(find(p.sourceItemId)) ?? []), p]);

  return [...groups.values()]
    .map(members => {
      const forwarded = members.filter(m => m.forwardOrigin);
      const originKeys = new Set(forwarded.map(m => norm(m.forwardOrigin!)));
      const established = [...originKeys].some(k => members.some(m => !m.forwardOrigin && norm(m.sourceKey) === k));
      const origin: OriginStatus = established ? 'established' : originKeys.size > 0 ? 'named' : 'unknown';
      const ids = members.map(m => m.sourceItemId).sort((a, b) => a - b);
      return { key: `family:${ids[0]}`, members: ids, origin };
    })
    .sort((a, b) => a.members[0]! - b.members[0]!);
};

// ---------------------------------------------------------------------------

const identityBlock = (input: ICompanySignalInput, publications: readonly ISignalPublication[]): IIdentityBlock => {
  const identifiers: Record<string, number> = {};
  for (const i of input.identifiers) identifiers[i.type] = (identifiers[i.type] ?? 0) + 1;
  const status =
    input.openAmbiguities > 0 || input.pendingMerges > 0
      ? 'ambiguous'
      : input.identifiers.some(i => i.validationStatus === 'checksum_valid')
        ? 'identified'
        : input.identifiers.length > 0
          ? 'identifier_unverified'
          : 'name_only';
  const completeness: Record<string, number> = {};
  for (const p of publications) completeness[p.completeness] = (completeness[p.completeness] ?? 0) + 1;
  return {
    status,
    entityType: input.entityType,
    identifiers,
    aliases: input.aliases,
    openAmbiguities: input.openAmbiguities,
    pendingMerges: input.pendingMerges,
    coverage: {
      publications: aggregate(
        publications.map(p => p.sourceItemId),
        'публикации с активным доказательством любого утверждения, где компания — сторона',
        { insufficientWhenZero: true },
      ),
      sources: new Set(publications.map(p => p.sourceKey)).size,
      completeness,
      legacyUnimported: input.legacyUnimported,
      note: 'Сведения ограничены собранными публикациями; отсутствие в выборке не означает отсутствия в действительности.',
    },
  };
};

/** Дата края выборки: какая публикация её дала. Ни одной даты — insufficient_data, а не «давно». */
const edgeDate = (publications: readonly ISignalPublication[], edge: 'first' | 'latest'): IDateSignal => {
  const dated = publications
    .filter(p => p.publishedAt)
    .map(p => ({ date: p.publishedAt!.slice(0, 10), sourceItemId: p.sourceItemId }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.sourceItemId - b.sourceItemId);
  const rule =
    edge === 'first'
      ? 'самая ранняя дата публикации в выборке; публикации без даты не учитываются'
      : 'самая поздняя дата публикации в выборке; публикации без даты не учитываются';
  const pick = edge === 'first' ? dated[0] : dated[dated.length - 1];
  if (!pick) return { value: null, status: 'insufficient_data', rule, sourceItemId: null };
  return { value: pick.date, status: 'ok', rule, sourceItemId: pick.sourceItemId };
};

const experienceBlock = (input: ICompanySignalInput): IExperienceBlock => {
  const id = input.companyId;
  const current = input.assertions.filter(supports);
  const participations = current.filter(a => a.predicate === 'participates_in_project' && a.subjectCompanyId === id && a.objectProjectId !== null);
  const counted = participations.filter(a => a.polarity === 'positive' && FACT_MODALITIES.has(a.modality) && reviewLevel(a) !== 'rejected');

  const byRole: Record<string, number[]> = {};
  const byWp: Record<string, number[]> = {};
  for (const a of counted) {
    (byRole[a.role ?? 'unknown'] ??= []).push(a.objectProjectId!);
    (byWp[a.workPackage ?? 'не указан'] ??= []).push(a.objectProjectId!);
  }
  const reviewedIds = counted.filter(a => reviewLevel(a) === 'reviewed').map(a => a.id);

  // Договор и корпоративная связь считаются по тому же правилу, что и участие: положительно,
  // как факт, не отклонено. План, отрицание и слух остаются в списках, но не в числе.
  const contractAssertions = current.filter(a => a.predicate === 'contract' && (a.subjectCompanyId === id || a.objectCompanyId === id));
  const corporateAssertions = current.filter(a => a.predicate === 'corporate_relation' && (a.subjectCompanyId === id || a.objectCompanyId === id));
  const positiveFact = (a: ISignalAssertion): boolean =>
    a.polarity === 'positive' && FACT_MODALITIES.has(a.modality) && reviewLevel(a) !== 'rejected';
  const countedContracts = contractAssertions.filter(positiveFact);
  const countedCorporate = corporateAssertions.filter(positiveFact);
  const otherSide = (a: ISignalAssertion): number | null => (a.subjectCompanyId === id ? a.objectCompanyId : a.subjectCompanyId);
  const counterpartyIds = [...countedContracts, ...countedCorporate].map(otherSide).filter((x): x is number => x !== null);

  return {
    projects: aggregate(counted.map(a => a.objectProjectId!), 'разные объекты, где сообщается об участии компании (положительно, как факт, не отклонено); id — объекты'),
    byRole: Object.fromEntries(Object.entries(byRole).map(([role, ids]) => [role, aggregate(ids, `объекты с ролью ${role}; id — объекты`)])),
    byWorkPackage: Object.fromEntries(Object.entries(byWp).map(([wp, ids]) => [wp, aggregate(ids, `объекты с пакетом работ «${wp}»; id — объекты`)])),
    reviewed: share(reviewedIds, counted.length, 'доля утверждений об участии, подтверждённых аналитиком; знаменатель — учтённые утверждения об участии'),
    contractsCount: aggregate(
      countedContracts.map(a => a.id),
      'договоры, о которых сообщается (положительно, как факт, не отклонено); знаменатель — все договорные утверждения со стороной-компанией; id — утверждения',
      { denominator: contractAssertions.length },
    ),
    corporateCount: aggregate(
      countedCorporate.map(a => a.id),
      'корпоративные связи, о которых сообщается (положительно, как факт, не отклонено); знаменатель — все корпоративные утверждения; id — утверждения',
      { denominator: corporateAssertions.length },
    ),
    counterparties: aggregate(
      counterpartyIds,
      'разные компании, названные другой стороной учтённого договора или корпоративной связи; сторона без карточки в число не входит; id — компании',
      { denominator: countedContracts.length + countedCorporate.length },
    ),
    participations: counted.map(a => ({
      assertionId: a.id,
      projectId: a.objectProjectId!,
      role: a.role ?? 'unknown',
      building: a.scopeBuilding,
      workPackage: a.workPackage,
      workPackageLabel: a.workPackageLabel,
      validFrom: a.validFrom,
      validTo: a.validTo,
      periodPrecision: a.periodPrecision,
      review: reviewLevel(a),
      needsRevalidation: a.needsRevalidation,
    })),
    notCounted: participations
      .filter(a => !counted.includes(a))
      .map(a => ({ assertionId: a.id, projectId: a.objectProjectId, role: a.role, modality: a.modality, polarity: a.polarity, review: reviewLevel(a) })),
    contracts: current
      .filter(a => a.predicate === 'contract' && (a.subjectCompanyId === id || a.objectCompanyId === id))
      .map(a => ({
        assertionId: a.id,
        side: a.subjectCompanyId === id ? ('client' as const) : ('performer' as const),
        role: a.role,
        counterpartCompanyId: a.subjectCompanyId === id ? a.objectCompanyId : a.subjectCompanyId,
        projectId: a.contextProjectId,
        modality: a.modality,
        polarity: a.polarity,
        value: valueOf(a),
        review: reviewLevel(a),
      })),
    corporate: current
      .filter(a => a.predicate === 'corporate_relation' && (a.subjectCompanyId === id || a.objectCompanyId === id))
      .map(a => ({
        assertionId: a.id,
        role: a.role,
        direction: a.subjectCompanyId === id ? ('outgoing' as const) : ('incoming' as const),
        otherCompanyId: a.subjectCompanyId === id ? a.objectCompanyId : a.subjectCompanyId,
        review: reviewLevel(a),
      })),
    note: 'Стоимость объекта участнику не приписывается; суммы договоров и требований не складываются.',
  };
};

const mediaBlock = (input: ICompanySignalInput, cutoff: Date, publications: readonly ISignalPublication[]): IMediaBlock => {
  const id = input.companyId;
  const window12 = windowMonths(cutoff, 12, 'event_date');
  const window90 = windowDays(cutoff, 90, 'publication_date');
  const pubById = new Map(publications.map(p => [p.sourceItemId, p]));
  const families = originFamilies(publications);
  const familyOf = new Map<number, string>();
  for (const f of families) for (const m of f.members) familyOf.set(m, f.key);

  const partyEvents = input.assertions.filter(
    a => a.predicate === 'event' && supports(a) && (a.subjectCompanyId === id || a.counterpartyCompanyId === id),
  );
  const notCounted: IMediaBlock['notCounted'] = [];
  const events: IEventItem[] = [];
  for (const a of partyEvents) {
    if (a.polarity === 'negative') {
      notCounted.push({ assertionId: a.id, type: a.eventType, reason: 'источник сообщает, что события не было' });
      continue;
    }
    if (!EVENT_MODALITIES.has(a.modality)) {
      notCounted.push({ assertionId: a.id, type: a.eventType, reason: a.modality === 'planned' ? 'план, не событие' : 'возможность или слух, не событие' });
      continue;
    }
    const items = itemsOf(a);
    const asSubject = a.subjectCompanyId === id;
    events.push({
      assertionId: a.id,
      type: a.eventType ?? 'other',
      companyRole: asSubject ? 'subject' : 'counterparty',
      proceduralRole: asSubject ? a.proceduralRole : a.counterpartyRole,
      caseNumber: a.caseNumber,
      stage: a.eventStage,
      outcome: a.eventOutcome,
      validFrom: a.validFrom,
      validTo: a.validTo,
      periodPrecision: a.periodPrecision,
      dateStatus: dateStatus(a.validFrom, a.validTo, window12),
      review: reviewLevel(a),
      needsRevalidation: a.needsRevalidation,
      modality: a.modality,
      value: valueOf(a),
      publications: items.length,
      families: new Set(items.map(i => familyOf.get(i) ?? `item:${i}`)).size,
      attribution: 'source_reported',
    });
  }

  const live = events.filter(e => e.review !== 'rejected');
  const eventsByReview: Record<ReviewLevel, number> = { reviewed: 0, text_grounded: 0, legacy_unreviewed: 0, disputed: 0, rejected: 0 };
  for (const e of events) eventsByReview[e.review] += 1;

  const earliestPublication = (e: IEventItem): string | null => {
    const assertion = partyEvents.find(a => a.id === e.assertionId)!;
    const dates = itemsOf(assertion).map(i => pubById.get(i)?.publishedAt).filter((d): d is string => Boolean(d)).sort();
    return dates[0] ? dates[0].slice(0, 10) : null;
  };

  const cases = new Map<string, ILegalCase>();
  const courtRoles = { plaintiff: 0, defendant: 0, other: 0, unknown: 0 };
  for (const e of live.filter(x => COURT_TYPES.has(x.type))) {
    const key = e.caseNumber ? `case:${e.caseNumber.replace(/\s+/g, '').toUpperCase()}` : `assertion:${e.assertionId}`;
    const entry = cases.get(key) ?? { caseKey: key, caseNumber: e.caseNumber, companyProceduralRole: null, stages: [] };
    entry.companyProceduralRole ??= e.proceduralRole;
    entry.stages.push({ assertionId: e.assertionId, stage: e.stage, outcome: e.outcome, validFrom: e.validFrom, review: e.review });
    cases.set(key, entry);
  }
  for (const c of cases.values()) {
    c.stages.sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? '') || a.assertionId - b.assertionId);
    const role = c.companyProceduralRole;
    if (role === 'plaintiff' || role === 'applicant' || role === 'creditor') courtRoles.plaintiff += 1;
    else if (role === 'defendant' || role === 'debtor') courtRoles.defendant += 1;
    else if (role) courtRoles.other += 1;
    else courtRoles.unknown += 1;
  }

  const ids = (pred: (e: IEventItem) => boolean): number[] => live.filter(pred).map(e => e.assertionId);
  const undated = live.filter(e => e.dateStatus === 'undated');
  const datedPublications = publications.filter(p => p.publishedAt);

  return {
    publications: aggregate(publications.map(p => p.sourceItemId), 'все публикации, где компания — сторона утверждения (перепечатки считаются отдельно)', { insufficientWhenZero: true }),
    publications90d: aggregate(
      datedPublications.filter(p => p.publishedAt!.slice(0, 10) >= window90.from && p.publishedAt!.slice(0, 10) <= window90.to).map(p => p.sourceItemId),
      'публикации с датой публикации в окне; знаменатель — публикации с известной датой',
      { window: window90, denominator: datedPublications.length },
    ),
    publicationsUndated: aggregate(publications.filter(p => !p.publishedAt).map(p => p.sourceItemId), 'публикации без даты публикации — ни в какое окно не входят'),
    firstPublishedAt: edgeDate(publications, 'first'),
    latestPublishedAt: edgeDate(publications, 'latest'),
    observations: publications.reduce((sum, p) => sum + p.observations, 0),
    families: aggregate(families.map(f => f.members[0]!), 'семьи публикаций с одинаковым текстом; id — первая публикация семьи', { insufficientWhenZero: true }),
    familiesByOrigin: {
      established: aggregate(families.filter(f => f.origin === 'established').map(f => f.members[0]!), 'первоисточник семьи есть в выборке'),
      named: aggregate(families.filter(f => f.origin === 'named').map(f => f.members[0]!), 'пересылки называют источник, его публикации в выборке нет'),
      unknown: aggregate(families.filter(f => f.origin === 'unknown').map(f => f.members[0]!), 'происхождение не установлено — не считается независимым подтверждением'),
    },
    events,
    eventsDated12m: aggregate(ids(e => e.dateStatus === 'in_window' || e.dateStatus === 'boundary'), 'события с датой события в окне (включая пересекающие границу); без даты — не входят', { window: window12, denominator: live.length }),
    eventsBoundary12m: aggregate(ids(e => e.dateStatus === 'boundary'), 'события, чей интервал даты (месяц, квартал, год) частично вне окна', { window: window12 }),
    eventsUndated: aggregate(undated.map(e => e.assertionId), 'события без даты события — не входят ни в одно окно событий'),
    eventsUndatedPublished90d: aggregate(
      undated.filter(e => {
        const first = earliestPublication(e);
        return first !== null && first >= window90.from && first <= window90.to;
      }).map(e => e.assertionId),
      'события без даты, впервые опубликованные в окне публикаций (это окно публикаций, не событий)',
      { window: window90 },
    ),
    eventsFuture: aggregate(ids(e => e.dateStatus === 'future'), 'события с датой позже среза (план или ошибка даты) — не входят в окно', { window: window12 }),
    eventsByReview,
    eventsByType: Object.fromEntries(
      [...new Set(live.map(e => e.type))].sort().map(type => [
        type,
        aggregate(live.filter(e => e.type === type).map(e => e.assertionId), `неотклонённые события вида «${type}»; id — утверждения`),
      ]),
    ),
    legalCasesCount: aggregate(
      [...cases.values()].map(c => c.stages[0]!.assertionId),
      'судебные и банкротные дела: стадии с одним номером дела — одно дело, без номера — отдельное; id — первая стадия дела',
    ),
    reviewedShare: share(ids(e => e.review === 'reviewed'), live.length, 'доля событий, подтверждённых аналитиком; знаменатель — неотклонённые события'),
    legalCases: [...cases.values()].sort((a, b) => a.caseKey.localeCompare(b.caseKey)),
    courtRoles,
    notCounted,
    note:
      live.length === 0
        ? 'В собранной выборке событий с участием компании не найдено — это не означает, что их не было.'
        : 'События — со слов источников; суд описывается ролью и стадией, без вывода о нарушении.',
  };
};

export const computeCompanySignals = (input: ICompanySignalInput, cutoff: Date): ICompanySignals => {
  const publications = [...input.publications].sort((a, b) => a.sourceItemId - b.sourceItemId);
  return {
    rulesVersion: SIGNAL_RULES_VERSION,
    cutoff: cutoff.toISOString(),
    companyId: input.companyId,
    identity: identityBlock(input, publications),
    experience: experienceBlock(input),
    media: mediaBlock(input, cutoff, publications),
  };
};
