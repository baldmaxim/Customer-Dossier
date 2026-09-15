// Досье обращения: чистая функция загруженных фактов. Модель не вызывается, итог — не решение о сотрудничестве.
//
// Порядок: предмет обращения → 3–5 значимых наблюдений с основаниями → заявленная и установленная роль →
// кто заказывает работы (документированные договоры отдельно от совместного участия) → контекст объекта →
// неопределённости → вопросы контрагенту только по реальным пробелам.

import { overlap } from '../signals/intervals.js';
import type { IRefreshState } from '../signals/refresh.js';
import type { ICaseRow } from './cases.js';
import type { IFact } from './facts.js';
import { dateText, eventText, factStatement, outcomeText, plainStatement, proceduralText, roleText, stageText, type IStatement } from './statements.js';

export const DOSSIER_TEMPLATE_VERSION = 'dossier-template@1';

export interface ICaseDossierInput {
  caseRow: ICaseRow;
  generatedAt: string;
  refresh: IRefreshState;
  identityStatus: string | null;
  homonyms: Array<{ id: number; name: string; entityType: string; legalForm: string | null; city: string | null; identifiers: string[] }>;
  companyFacts: IFact[];
  projectFacts: IFact[];
  projectState: Array<{ building: string | null; state: string; validFrom: string; periodPrecision: string }>;
  openQueue: Array<{ kind: string; assertionId: number; priority: number }>;
}

export type RoleStatus = 'reviewed' | 'reported' | 'contradicted' | 'not_established' | 'no_project' | 'no_company';
export type ChainStatus = 'documented' | 'differs_from_claim' | 'not_documented' | 'no_project' | 'no_company';

export interface ICaseDossier {
  templateVersion: string;
  caseId: number;
  caseVersion: number;
  generatedAt: string;
  freshness: { signalsCutoff: string | null; stale: boolean; staleReasons: string[]; latestEvidenceAt: string | null };
  subject: IStatement[];
  observations: IStatement[];
  role: { claimed: IStatement | null; status: RoleStatus; established: IStatement[]; otherBuildings: IStatement[]; contradictions: IStatement[] };
  chain: { claimed: IStatement | null; status: ChainStatus; documented: IStatement[]; subcontracts: IStatement[]; coParticipants: IStatement[] };
  terms: { claimed: IStatement | null; fromSources: IStatement[] };
  projectContext: { state: IStatement[]; events: IStatement[] };
  companyEvents: IStatement[];
  uncertainties: IStatement[];
  questions: Array<{ code: string; text: string; basedOn: string }>;
  disclaimer: string;
}

const FACT = new Set(['reported_fact', 'unknown']);
const isFact = (f: IFact): boolean => f.polarity === 'positive' && FACT.has(f.modality) && f.status !== 'rejected';

export const buildCaseDossier = (input: ICaseDossierInput): ICaseDossier => {
  const c = input.caseRow;
  const companyId = c.companyId;
  const projectId = c.projectId;
  const building = c.scopeBuilding?.trim().toLowerCase() ?? null;

  // --- предмет обращения
  const subject: IStatement[] = [];
  if (companyId !== null) {
    subject.push(plainStatement('company_selected', 'operator_claim', `Юрлицо выбрано оператором: ${c.companyName ?? `#${companyId}`}.`));
  } else {
    subject.push(plainStatement('company_unidentified', 'not_established', `Юрлицо не установлено. Название со слов обратившегося: «${c.companyNameClaimed}».`));
  }
  if (input.homonyms.length > 0) {
    subject.push(
      plainStatement(
        'homonyms',
        'system_context',
        `В базе ${companyId !== null ? 'есть другие' : 'есть'} компании с таким же названием (${input.homonyms.length}): ${input.homonyms
          .map(h => `${h.name}${h.legalForm ? ` (${h.legalForm})` : ''}${h.identifiers.length ? `, ${h.identifiers.join(', ')}` : ', реквизитов нет'}`)
          .join('; ')} — сведения о них в досье не смешиваются.`,
      ),
    );
  }
  subject.push(
    projectId !== null
      ? plainStatement('project_selected', 'operator_claim', `Объект: ${c.projectName ?? `#${projectId}`}${c.scopeBuilding ? `, ${c.scopeBuilding}` : ''}${c.workPackageLabel ? `; работы: ${c.workPackageLabel}` : ''}.`)
      : plainStatement('project_unselected', 'not_established', `Объект в базе не выбран${c.projectNameClaimed ? ` (со слов: «${c.projectNameClaimed}»)` : ''}.`),
  );

  // --- роль
  const claimedRole = c.claimedRole
    ? plainStatement('claimed_role', 'operator_claim', `Со слов обратившегося компания — ${roleText(c.claimedRole)}${c.scopeBuilding ? ` (${c.scopeBuilding})` : ''}. Это запись оператора, не подтверждённый факт.`)
    : null;

  const participations = input.companyFacts.filter(f => f.predicate === 'participates_in_project' && f.subjectCompanyId === companyId && projectId !== null && f.objectProjectId === projectId);
  const sameBuilding = (f: IFact): boolean => !building || !f.scopeBuilding || f.scopeBuilding.toLowerCase() === building;
  const positive = participations.filter(isFact);
  const established = positive.filter(sameBuilding).map(f =>
    factStatement(
      'role_established',
      f,
      `${f.subjectCompanyName} — ${roleText(f.role)} на объекте ${f.objectProjectName}${f.scopeBuilding ? `, ${f.scopeBuilding}` : ''}${f.workPackage ?? f.workPackageLabel ? `; работы: ${f.workPackage ?? f.workPackageLabel}` : ''}${f.validFrom ? `; с ${dateText(f.validFrom, f.periodPrecision)}` : ''}`,
    ),
  );
  const otherBuildings = positive
    .filter(f => !sameBuilding(f))
    .map(f => factStatement('role_other_building', f, `${f.subjectCompanyName} — ${roleText(f.role)}, но на ${f.scopeBuilding}, а не на ${c.scopeBuilding}`));
  const contradictions = [
    ...participations.filter(f => f.polarity === 'negative').map(f => factStatement('role_denied', f, `${f.subjectCompanyName} — не ${roleText(f.role)} на объекте ${f.objectProjectName}`)),
    ...participations
      .filter(f => f.polarity === 'positive' && f.evidence.some(e => e.stance === 'contradicts'))
      .map(f => factStatement('role_contradicted', f, `сведения о роли «${roleText(f.role)}» опровергаются другой публикацией`)),
  ];
  const roleStatus: RoleStatus =
    companyId === null
      ? 'no_company'
      : projectId === null
        ? 'no_project'
        : contradictions.length > 0
          ? 'contradicted'
          : positive.some(f => sameBuilding(f) && f.status === 'reviewed_supported')
            ? 'reviewed'
            : established.length > 0
              ? 'reported'
              : 'not_established';

  // --- цепочка: кто заказывает работы
  const onProject = (f: IFact): boolean => projectId !== null && (f.contextProjectId === projectId || f.contextProjectId === null);
  const contracts = input.companyFacts.filter(f => f.predicate === 'contract' && isFact(f) && onProject(f));
  const documented = contracts
    .filter(f => f.objectCompanyId === companyId)
    .map(f => factStatement('contract_client', f, `${f.subjectCompanyName} — заказчик по договору (${roleText(f.role)}), исполнитель ${f.objectCompanyName}${f.contextProjectId === null ? '; объект договора в публикации не назван' : ''}`));
  const subcontracts = contracts
    .filter(f => f.subjectCompanyId === companyId)
    .map(f => factStatement('contract_subcontract', f, `${f.subjectCompanyName} заказывает работы у ${f.objectCompanyName} (${roleText(f.role)})`));
  const claimedClientName = c.claimedClientCompanyName ?? c.claimedClientName;
  const claimedChain = claimedClientName
    ? plainStatement('claimed_client', 'operator_claim', `Со слов обратившегося работы заказывает ${claimedClientName}. Это запись оператора, не подтверждённый договор.`)
    : null;
  const coParticipants = input.projectFacts
    .filter(f => f.predicate === 'participates_in_project' && isFact(f) && f.subjectCompanyId !== companyId && f.objectProjectId === projectId)
    .map(f =>
      factStatement('co_participant', f, `на объекте участвует ${f.subjectCompanyName} (${roleText(f.role)}${f.scopeBuilding ? `, ${f.scopeBuilding}` : ''}) — совместное участие, договор между компаниями этим не установлен`),
    );
  const chainStatus: ChainStatus =
    companyId === null
      ? 'no_company'
      : projectId === null
        ? 'no_project'
        : documented.length === 0
          ? 'not_documented'
          : c.claimedClientCompanyId !== null && !contracts.some(f => f.objectCompanyId === companyId && f.subjectCompanyId === c.claimedClientCompanyId)
            ? 'differs_from_claim'
            : 'documented';

  // --- условия
  const termsClaimed = c.claimedTerms ? plainStatement('claimed_terms', 'operator_claim', `Условия со слов обратившегося: ${c.claimedTerms}. Не проверено, не рассчитывалось.`) : null;
  const termsFromSources = contracts
    .filter(f => f.valueNumeric && (f.objectCompanyId === companyId || f.subjectCompanyId === companyId))
    .map(f => factStatement('contract_value', f, `сумма по договору ${f.subjectCompanyName} → ${f.objectCompanyName}: ${f.valueNumeric} ${f.valueCurrency ?? '(валюта не указана)'}${f.valueType && f.valueType !== 'contract' ? ` (${f.valueType})` : ''}`));

  // --- контекст объекта: события объекта и пересечение с участием компании
  const periods = positive.filter(sameBuilding).map(f => ({ validFrom: f.validFrom, validTo: f.validTo }));
  const projectEvents = input.projectFacts
    .filter(f => f.predicate === 'event' && f.polarity === 'positive' && ['reported_fact', 'claim', 'unknown'].includes(f.modality) && f.status !== 'rejected')
    .filter(f => f.subjectCompanyId === null || f.subjectCompanyId !== companyId)
    .map(f => {
      const o = periods.map(p => overlap(p, f));
      const relation = o.includes('overlaps')
        ? 'период события пересекается с участием компании — это контекст, не ответственность'
        : o.length > 0 && o.every(x => x === 'no_overlap')
          ? 'событие вне периода участия компании'
          : 'соотношение с периодом участия компании неизвестно';
      const otherBuilding = building && f.scopeBuilding && f.scopeBuilding.toLowerCase() !== building ? `; относится к ${f.scopeBuilding}` : '';
      return factStatement('project_event', f, `${eventText(f.eventType)} на объекте (${dateText(f.validFrom, f.periodPrecision)})${otherBuilding}; ${relation}`);
    });
  const state = input.projectState.map(s => plainStatement('project_state', 'system_context', `Состояние по действительной дате: ${s.building ? `${s.building} — ` : ''}${s.state} с ${dateText(s.validFrom, s.periodPrecision)}.`));

  // --- события компании
  const companyEventFacts = input.companyFacts.filter(
    f => f.predicate === 'event' && (f.subjectCompanyId === companyId || f.counterpartyCompanyId === companyId) && f.polarity === 'positive' && ['reported_fact', 'claim', 'unknown'].includes(f.modality),
  );
  const LEGAL = new Set(['court_case', 'bankruptcy', 'bankruptcy_intent', 'bankruptcy_filing', 'bankruptcy_procedure', 'payment_claim']);
  const companyEvents = companyEventFacts
    .map(f => {
      const role = f.subjectCompanyId === companyId ? f.proceduralRole : f.counterpartyRole;
      const other = f.subjectCompanyId === companyId ? f.counterpartyCompanyName : f.subjectCompanyName;
      const roleWord = proceduralText(role);
      return factStatement(
        'company_event',
        f,
        `${eventText(f.eventType)}${f.caseNumber ? ` № ${f.caseNumber}` : ''}${roleWord ? `, компания — ${roleWord}` : ''}${other ? `, другая сторона — ${other}` : ''}; ${dateText(f.validFrom, f.periodPrecision)}${f.eventStage ? `; стадия по источнику: ${stageText(f.eventStage)}` : '; стадия не указана'}${f.eventOutcome ? `; результат по источнику: ${outcomeText(f.eventOutcome)}` : ''}${f.eventType === 'court_case' ? '. Наличие дела не означает нарушения' : ''}`,
      );
    });

  // --- наблюдения: 3–5 значимых с источниками, в фиксированном порядке
  const observations: IStatement[] = [
    ...contradictions,
    ...established.sort((a, b) => (a.attribution === 'analyst_reviewed' ? -1 : 0) - (b.attribution === 'analyst_reviewed' ? -1 : 0)),
    ...documented,
    ...companyEvents.filter((_s, i) => LEGAL.has(companyEventFacts[i]!.eventType ?? '')),
    ...projectEvents.filter(s => s.text.includes('пересекается с участием')),
    ...otherBuildings,
  ].slice(0, 5);
  if (observations.length === 0 && companyId !== null) {
    observations.push(plainStatement('nothing_found', 'not_established', 'В собранной выборке сведений об участии компании в этом объекте, её договорах и событиях не найдено. Это не означает, что их нет.'));
  }

  // --- неопределённости и вопросы — только по реальным пробелам
  const uncertainties: IStatement[] = [];
  const questions: ICaseDossier['questions'] = [];
  const gap = (code: string, text: string, question: string | null): void => {
    uncertainties.push(plainStatement(code, 'not_established', text));
    if (question) questions.push({ code: `ask_${code}`, text: question, basedOn: code });
  };

  if (companyId === null) {
    gap('company_unidentified', 'Юрлицо не установлено: сведения о компании не показываются, чтобы не смешать одноимённые.', 'Запросить полное наименование, ИНН и ОГРН компании.');
  } else if (input.identityStatus === 'name_only' || input.identityStatus === 'identifier_unverified') {
    gap('identifiers_missing', 'Реквизиты компании в выборке не установлены или не проверены.', 'Запросить ИНН и ОГРН, сверить с выбранным юрлицом.');
  } else if (input.identityStatus === 'ambiguous') {
    gap('identity_ambiguous', 'Идентичность компании под вопросом: есть неоднозначность или пара на слияние.', null);
  }
  if (input.homonyms.length > 0 && companyId !== null) {
    gap('homonyms_exist', `Есть одноимённые компании (${input.homonyms.length}) — убедитесь, что выбрано нужное юрлицо.`, null);
  }
  if (projectId === null) {
    gap('project_unselected', 'Объект не выбран в базе — роль и договорная цепочка не проверялись.', 'Уточнить объект, очередь и корпус работ.');
  }
  if (roleStatus === 'not_established') {
    gap('role_not_established', 'Участие компании в объекте по собранным источникам не установлено.', 'Запросить подтверждение участия: договор или письмо заказчика по объекту и корпусу.');
  }
  if (roleStatus === 'contradicted') {
    gap('role_contradicted', 'Источники противоречат друг другу о роли компании на объекте.', 'Прояснить противоречие о роли компании на объекте (есть сообщения «за» и «против»).');
  }
  const establishedRoles = new Set(positive.filter(sameBuilding).map(f => f.role));
  if (c.claimedRole && establishedRoles.size > 0 && !establishedRoles.has(c.claimedRole)) {
    gap('role_differs', `Заявленная роль (${roleText(c.claimedRole)}) не совпадает с ролью в источниках (${[...establishedRoles].map(roleText).join(', ')}).`, 'Уточнить фактическую роль компании на объекте.');
  }
  if (otherBuildings.length > 0 && established.length === 0) {
    gap('building_differs', 'В источниках компания связана с другим корпусом объекта.', 'Подтвердить корпус или очередь, на которых выполняются работы.');
  }
  if (c.scopeBuilding === null && projectId !== null) {
    gap('building_unspecified', 'Корпус или очередь в обращении не указаны.', 'Уточнить корпус или очередь.');
  }
  if (projectId !== null && companyId !== null && chainStatus === 'not_documented') {
    gap('chain_not_documented', 'Договорная цепочка (кто заказывает работы у компании) по источникам не установлена.', 'Кто заказчик работ и на основании какого договора (номер, дата)?');
  }
  if (chainStatus === 'differs_from_claim') {
    gap('chain_differs', 'Заявленный заказчик работ не совпадает с заказчиком в документированных договорах.', 'Пояснить, кто заказывает работы: в источниках указан другой заказчик.');
  }
  if (!c.workPackageLabel && !positive.some(f => f.workPackage || f.workPackageLabel)) {
    gap('work_package_unknown', 'Объём и вид работ не установлены.', 'Уточнить объём работ и границы ответственности.');
  }
  if (termsFromSources.length === 0) {
    gap('terms_not_in_sources', 'Условия оплаты, цена и аванс в источниках не указаны — не рассчитываются и не предполагаются.', c.claimedTerms ? null : 'Запросить условия договора: цена, порядок оплаты, аванс.');
  }
  if (companyEventFacts.some(f => f.eventType === 'court_case')) {
    gap('court_cases_present', 'В источниках упоминаются судебные дела с участием компании; стадия или результат могут быть неизвестны.', 'Если существенно для решения — пояснить судебные дела (номер, предмет, стадия).');
  }
  const undated = input.companyFacts.filter(f => f.predicate === 'event' && !f.validFrom).length;
  if (undated > 0) gap('events_undated', `Событий без даты в источниках: ${undated} — к периоду обращения не привязаны.`, null);
  if (input.openQueue.length > 0) {
    gap('review_pending', `Непроверенные противоречия и изменения оснований по сведениям о компании: ${input.openQueue.length}.`, null);
  }
  if (!input.refresh.active) gap('signals_not_computed', 'Сигналы компании ещё не рассчитывались.', null);
  else if (input.refresh.stale) gap('signals_stale', `Сигналы устарели: ${input.refresh.staleReasons.join('; ')}.`, null);

  const allEvidence = [...input.companyFacts, ...input.projectFacts].flatMap(f => f.evidence.map(e => e.publishedAt)).filter((d): d is string => Boolean(d)).sort();

  return {
    templateVersion: DOSSIER_TEMPLATE_VERSION,
    caseId: c.id,
    caseVersion: c.version,
    generatedAt: input.generatedAt,
    freshness: {
      signalsCutoff: input.refresh.active?.cutoffAt ?? null,
      stale: input.refresh.stale,
      staleReasons: input.refresh.staleReasons,
      latestEvidenceAt: allEvidence[allEvidence.length - 1] ?? null,
    },
    subject,
    observations,
    role: { claimed: claimedRole, status: roleStatus, established, otherBuildings, contradictions },
    chain: { claimed: claimedChain, status: chainStatus, documented, subcontracts, coParticipants },
    terms: { claimed: termsClaimed, fromSources: termsFromSources },
    projectContext: { state, events: projectEvents },
    companyEvents,
    uncertainties,
    questions,
    disclaimer: 'Досье собрано из открытых публикаций и записей оператора. Это не проверка контрагента, не оценка надёжности и не решение о сотрудничестве.',
  };
};
