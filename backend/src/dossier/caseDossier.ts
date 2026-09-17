// Досье обращения: чистая функция загруженных фактов. Модель не вызывается, итог — не решение о сотрудничестве.
//
// Порядок: предмет обращения → 3–5 значимых наблюдений с основаниями → заявленная и установленная роль →
// кто заказывает работы (документированные договоры отдельно от совместного участия) → контекст объекта →
// неопределённости → вопросы контрагенту только по реальным пробелам.

import { overlap } from '../signals/intervals.js';
import type { IRefreshState } from '../signals/refresh.js';
import type { ICaseRow } from './cases.js';
import type { ICoverage, IFact } from './facts.js';
import { matchScope, scopeNote, type ICaseScope, type IScopeMatch } from './scope.js';
import { dateText, eventText, factStatement, outcomeText, plainStatement, proceduralText, roleText, stageText, type IStatement } from './statements.js';

// @2 (этап 12): применимость по scope-match@1, контекстные списки role.context/chain.context, статусы scope_unknown.
export const DOSSIER_TEMPLATE_VERSION = 'dossier-template@2';

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
  /** Покрытие выборок (этап 13). Не передано — неизвестно, не «полно». */
  coverage?: ICoverage[];
}

export type RoleStatus = 'reviewed' | 'reported' | 'contradicted' | 'scope_unknown' | 'not_established' | 'no_project' | 'no_company';
export type ChainStatus = 'documented' | 'differs_from_claim' | 'scope_unknown' | 'not_documented' | 'no_project' | 'no_company';

export interface ICaseDossier {
  templateVersion: string;
  caseId: number;
  caseVersion: number;
  generatedAt: string;
  freshness: { signalsCutoff: string | null; stale: boolean; staleReasons: string[]; latestEvidenceAt: string | null };
  subject: IStatement[];
  observations: IStatement[];
  /** context — сведения, не применимые к обращению или с неизвестной частью scope (снимки до @2 поля не имеют). */
  role: { claimed: IStatement | null; status: RoleStatus; established: IStatement[]; otherBuildings: IStatement[]; contradictions: IStatement[]; context?: IStatement[] };
  chain: { claimed: IStatement | null; status: ChainStatus; documented: IStatement[]; subcontracts: IStatement[]; coParticipants: IStatement[]; context?: IStatement[] };
  terms: { claimed: IStatement | null; fromSources: IStatement[] };
  projectContext: { state: IStatement[]; events: IStatement[] };
  companyEvents: IStatement[];
  uncertainties: IStatement[];
  questions: Array<{ code: string; text: string; basedOn: string }>;
  /** Покрытие выборок, из которых построено досье (coverage@1); в досье до этапа 13 поля нет. */
  coverage?: ICoverage[];
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

  // Каждое утверждение сравнивается с предметом обращения по объекту, корпусу, виду работ, роли и дате (scope-match@1).
  // Неизвестное в источнике не подтверждает обращение: такие сведения — контекст с пометкой, что не указано.
  const scope: ICaseScope = { projectId, building: c.scopeBuilding, workPackage: c.workPackage, role: c.claimedRole, onDate: c.requestDate };
  const withScope = (s: IStatement, m: IScopeMatch): IStatement => ({ ...s, text: `${s.text.replace(/\.$/, '')}${scopeNote(m)}.`, scope: m });

  const participations = input.companyFacts.filter(f => f.predicate === 'participates_in_project' && f.subjectCompanyId === companyId && projectId !== null && f.objectProjectId === projectId);
  const positive = participations.filter(isFact);
  // Роль у участия — не условие применимости (расхождение роли — отдельный пробел role_differs).
  const matchOf = (f: IFact): IScopeMatch => matchScope(f, scope, { project: f.objectProjectId, roleOf: null });
  const describe = (f: IFact): string =>
    `${f.subjectCompanyName} — ${roleText(f.role)} на объекте ${f.objectProjectName}${f.scopeBuilding ? `, ${f.scopeBuilding}` : ''}${f.workPackage ?? f.workPackageLabel ? `; работы: ${f.workPackage ?? f.workPackageLabel}` : ''}${f.validFrom ? `; с ${dateText(f.validFrom, f.periodPrecision)}` : ''}${f.validTo ? ` по ${dateText(f.validTo, f.periodPrecision)}` : ''}`;
  const appliesTo = (m: IScopeMatch): boolean => m.conflicts.length === 0 && m.dimensions.building !== 'unknown';

  const establishedFacts = positive.filter(f => appliesTo(matchOf(f)));
  const established = establishedFacts.map(f => withScope(factStatement('role_established', f, describe(f)), matchOf(f)));
  const otherBuildings = positive
    .filter(f => matchOf(f).dimensions.building === 'conflict')
    .map(f => withScope(factStatement('role_other_building', f, `${f.subjectCompanyName} — ${roleText(f.role)}, но на ${f.scopeBuilding}, а не на ${c.scopeBuilding}`), matchOf(f)));
  const roleContext: IStatement[] = [
    // Корпус в источнике не указан при выбранном корпусе: сведения по объекту, для корпуса не установлено.
    ...positive
      .filter(f => matchOf(f).dimensions.building === 'unknown' && matchOf(f).conflicts.length === 0)
      .map(f => withScope(factStatement('role_project_level', f, `${describe(f)} — корпус в источнике не указан, для ${c.scopeBuilding} участие этим не установлено`), matchOf(f))),
    // Другой период или вид работ: смена подрядчика или другие работы — не текущая роль по обращению.
    ...positive
      .filter(f => matchOf(f).dimensions.building !== 'conflict' && matchOf(f).conflicts.some(d => d === 'period' || d === 'work'))
      .map(f => withScope(factStatement('role_other_scope', f, `${describe(f)} — относится к другому ${matchOf(f).conflicts.includes('period') ? 'периоду' : 'виду работ'}`), matchOf(f))),
  ];

  // Отрицание применимо, если не отклонено аналитиком и не противоречит обращению по корпусу, работам, периоду и роли.
  // Асимметрия намеренная: неизвестный корпус не ПОДТВЕРЖДАЕТ участие, но отрицание по объекту без корпуса остаётся
  // противоречием с пометкой «корпус не указан» — ошибка в сторону проверки, а не ложного подтверждения.
  const establishedRoles = new Set(establishedFacts.map(f => f.role));
  const negativeMatch = (f: IFact): IScopeMatch => {
    const roleConflict = f.role !== null && (c.claimedRole !== null || establishedRoles.size > 0) && f.role !== c.claimedRole && !establishedRoles.has(f.role);
    const m = matchOf(f);
    return roleConflict ? { ...m, dimensions: { ...m.dimensions, role: 'conflict' }, conflicts: [...m.conflicts, 'role'] } : m;
  };
  const negatives = participations.filter(f => f.polarity === 'negative');
  const activeNegatives = negatives.filter(f => f.status !== 'rejected');
  const applicableNegatives = activeNegatives.filter(f => negativeMatch(f).conflicts.length === 0);
  const contradictions = [
    ...applicableNegatives.map(f => withScope(factStatement('role_denied', f, `${f.subjectCompanyName} — не ${roleText(f.role)} на объекте ${f.objectProjectName}${f.scopeBuilding ? `, ${f.scopeBuilding}` : ''}`), negativeMatch(f))),
    ...establishedFacts
      .filter(f => f.evidence.some(e => e.stance === 'contradicts'))
      .map(f => factStatement('role_contradicted', f, `сведения о роли «${roleText(f.role)}» опровергаются другой публикацией`)),
  ];
  const unscopedNegatives = applicableNegatives.filter(f => negativeMatch(f).dimensions.building === 'unknown');
  roleContext.push(
    ...activeNegatives
      .filter(f => negativeMatch(f).conflicts.length > 0)
      .map(f => withScope(factStatement('role_denied_other_scope', f, `${f.subjectCompanyName} — не ${roleText(f.role)} на объекте ${f.objectProjectName}${f.scopeBuilding ? `, ${f.scopeBuilding}` : ''} — отрицание относится к другому корпусу, роли, работам или периоду и роль по обращению не опровергает`), negativeMatch(f))),
    // Отклонённое аналитиком отрицание остаётся в истории, но вывод не определяет.
    ...negatives
      .filter(f => f.status === 'rejected')
      .map(f => factStatement('role_denied_rejected', f, `${f.subjectCompanyName} — не ${roleText(f.role)} на объекте ${f.objectProjectName}; отрицание отклонено аналитиком и в выводе не учитывается`)),
  );
  const roleStatus: RoleStatus =
    companyId === null
      ? 'no_company'
      : projectId === null
        ? 'no_project'
        : contradictions.length > 0
          ? 'contradicted'
          : establishedFacts.some(f => f.status === 'reviewed_supported')
            ? 'reviewed'
            : established.length > 0
              ? 'reported'
              : roleContext.some(s => s.code === 'role_project_level' || s.code === 'role_other_scope')
                ? 'scope_unknown'
                : 'not_established';

  // --- цепочка: кто заказывает работы. Договор подтверждает обращение только по этому объекту, корпусу, работам и дате.
  const contracts = input.companyFacts.filter(f => f.predicate === 'contract' && isFact(f));
  const contractMatch = (f: IFact): IScopeMatch => matchScope(f, scope, { project: f.contextProjectId, roleOf: null });
  const contractDocuments = (f: IFact): boolean => {
    const m = contractMatch(f);
    return projectId !== null && m.dimensions.project === 'match' && appliesTo(m);
  };
  const documentedFacts = contracts.filter(f => f.objectCompanyId === companyId && contractDocuments(f));
  const documented = documentedFacts.map(f =>
    withScope(factStatement('contract_client', f, `${f.subjectCompanyName} — заказчик по договору (${roleText(f.role)}), исполнитель ${f.objectCompanyName}`), contractMatch(f)),
  );
  const subcontractFacts = contracts.filter(f => f.subjectCompanyId === companyId && contractDocuments(f));
  const subcontracts = subcontractFacts.map(f =>
    withScope(factStatement('contract_subcontract', f, `${f.subjectCompanyName} заказывает работы у ${f.objectCompanyName} (${roleText(f.role)})`), contractMatch(f)),
  );
  const chainContext = contracts
    .filter(f => (f.objectCompanyId === companyId || f.subjectCompanyId === companyId) && !contractDocuments(f))
    .map(f => {
      const m = contractMatch(f);
      const why =
        m.dimensions.project === 'unknown'
          ? 'объект договора в публикации не назван — общий фон отношений, не подтверждение по этому объекту'
          : m.dimensions.project === 'conflict'
            ? 'договор по другому объекту'
            : m.dimensions.building === 'unknown'
              ? 'корпус в договоре не указан — для корпуса обращения не установлено'
              : 'договор по другому корпусу, виду работ или периоду';
      return withScope(factStatement('contract_context', f, `${f.subjectCompanyName} → ${f.objectCompanyName} (${roleText(f.role)}): ${why}`), m);
    });
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
          ? chainContext.length > 0
            ? 'scope_unknown'
            : 'not_documented'
          : c.claimedClientCompanyId !== null && !documentedFacts.some(f => f.subjectCompanyId === c.claimedClientCompanyId)
            ? 'differs_from_claim'
            : 'documented';

  // --- условия: только из договоров, применимых к обращению
  const termsClaimed = c.claimedTerms ? plainStatement('claimed_terms', 'operator_claim', `Условия со слов обратившегося: ${c.claimedTerms}. Не проверено, не рассчитывалось.`) : null;
  const termsFromSources = [...documentedFacts, ...subcontractFacts]
    .filter(f => f.valueNumeric)
    .map(f => factStatement('contract_value', f, `сумма по договору ${f.subjectCompanyName} → ${f.objectCompanyName}: ${f.valueNumeric} ${f.valueCurrency ?? '(валюта не указана)'}${f.valueType && f.valueType !== 'contract' ? ` (${f.valueType})` : ''}`));

  // --- контекст объекта: события объекта и пересечение с участием компании
  const periods = establishedFacts.map(f => ({ validFrom: f.validFrom, validTo: f.validTo }));
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
  const truncated = (input.coverage ?? []).filter(cv => cv.truncated);
  if (observations.length === 0 && companyId !== null) {
    observations.push(
      truncated.length > 0
        ? plainStatement('nothing_found_in_loaded', 'not_established', 'В загруженной части выборки сведений об участии компании в этом объекте не найдено; выборка ограничена — остальные сведения не просмотрены.')
        : plainStatement('nothing_found', 'not_established', 'В собранной выборке сведений об участии компании в этом объекте, её договорах и событиях не найдено. Это не означает, что их нет.'),
    );
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
  if (roleStatus === 'scope_unknown') {
    gap('role_scope_unknown', 'Сведения об участии есть, но корпус, вид работ или период в источниках не указаны или другие — для предмета обращения не установлено.', 'Уточнить корпус, вид работ и период участия компании документом.');
  }
  if (unscopedNegatives.length > 0 && c.scopeBuilding) {
    gap('contradiction_scope_unknown', 'Отрицание участия не называет корпус — учтено как противоречие по объекту; к корпусу обращения относится ли, не установлено.', 'Прояснить сообщение об отрицании участия: к какому корпусу оно относится.');
  }
  if (c.claimedRole && establishedRoles.size > 0 && !establishedRoles.has(c.claimedRole)) {
    gap('role_differs', `Заявленная роль (${roleText(c.claimedRole)}) не совпадает с ролью в источниках (${[...establishedRoles].map(roleText).join(', ')}).`, 'Уточнить фактическую роль компании на объекте.');
  }
  if (otherBuildings.length > 0 && established.length === 0) {
    gap('building_differs', 'В источниках компания связана с другим корпусом объекта.', 'Подтвердить корпус или очередь, на которых выполняются работы.');
  }
  if (c.scopeBuilding === null && projectId !== null) {
    gap('building_unspecified', 'Корпус или очередь в обращении не указаны.', 'Уточнить корпус или очередь.');
  }
  if (projectId !== null && companyId !== null && (chainStatus === 'not_documented' || chainStatus === 'scope_unknown')) {
    gap('chain_not_documented', 'Прямой договор по этому объекту, корпусу и работам (кто заказывает работы у компании) по источникам не установлен.', 'Кто заказчик работ и на основании какого договора (номер, дата)?');
  }
  if (chainStatus === 'differs_from_claim') {
    gap('chain_differs', 'Заявленный заказчик работ не совпадает с заказчиком в документированных договорах.', 'Пояснить, кто заказывает работы: в источниках указан другой заказчик.');
  }
  if (!c.workPackageLabel && !establishedFacts.some(f => f.workPackage || f.workPackageLabel)) {
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
  for (const cv of truncated) {
    gap(`selection_truncated_${cv.source}`, `Выборка ограничена: загружено ${cv.loaded} из ${cv.total ?? 'неизвестного числа'} (${cv.source}). Выводы относятся к загруженной части; сведения по объекту обращения загружаются в первую очередь.`, null);
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
    role: { claimed: claimedRole, status: roleStatus, established, otherBuildings, contradictions, context: roleContext },
    chain: { claimed: claimedChain, status: chainStatus, documented, subcontracts, coParticipants, context: chainContext },
    terms: { claimed: termsClaimed, fromSources: termsFromSources },
    projectContext: { state, events: projectEvents },
    companyEvents,
    uncertainties,
    questions,
    ...(input.coverage ? { coverage: input.coverage } : {}),
    disclaimer: 'Досье собрано из открытых публикаций и записей оператора. Это не проверка контрагента, не оценка надёжности и не решение о сотрудничестве.',
  };
};
