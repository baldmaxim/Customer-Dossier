// Резюме досье компании (этап 08A): юридическая идентификация, роли, контрагенты по типу связи,
// противоречия и ограничения выборки — шаблонами поверх снимка сигналов и опубликованных утверждений.

import type { DbExecutor } from '../db/pool.js';
import { refreshState } from '../signals/refresh.js';
import type { ICompanySignals } from '../signals/types.js';
import { loadCompanyFacts, loadOpenQueue } from './facts.js';
import { factStatement, plainStatement, roleText, type IStatement } from './statements.js';

export interface ICompanySummary {
  generatedAt: string;
  signalsCutoff: string | null;
  stale: boolean;
  staleReasons: string[];
  summary: IStatement[];
  counterparties: {
    contracts: IStatement[];
    corporate: IStatement[];
    coParticipants: Array<{ companyId: number; companyName: string; projectId: number; projectName: string; roleOther: string | null; roleThis: string | null }>;
  };
  contradictions: Array<{ kind: string; assertionId: number; priority: number }>;
  limits: IStatement[];
  cases: Array<{ id: number; title: string; status: string }>;
}

const IDENTITY: Record<string, string> = {
  identified: 'реквизит с верной контрольной суммой',
  identifier_unverified: 'реквизит есть, но не проверен',
  name_only: 'только название, реквизиты в выборке не установлены',
  ambiguous: 'идентичность под вопросом (неоднозначность или пара на слияние)',
};

export const loadCompanySummary = async (exec: DbExecutor, companyId: number, now: Date = new Date()): Promise<ICompanySummary> => {
  const refresh = await refreshState();
  const snapshot = refresh.active
    ? ((
        await exec.query<{ payload: ICompanySignals }>('SELECT payload FROM company_signal_snapshots WHERE refresh_id = $1 AND company_id = $2', [
          refresh.active.id,
          companyId,
        ])
      ).rows[0]?.payload ?? null)
    : null;
  const facts = await loadCompanyFacts(exec, companyId);
  const fact = (f: (typeof facts)[number]): boolean => f.polarity === 'positive' && ['reported_fact', 'unknown'].includes(f.modality) && f.status !== 'rejected';

  const summary: IStatement[] = [];
  const limits: IStatement[] = [];
  if (snapshot) {
    summary.push(plainStatement('identity', 'system_context', `Идентификация: ${IDENTITY[snapshot.identity.status] ?? snapshot.identity.status}.`));
    const roles = Object.entries(snapshot.experience.byRole);
    summary.push(
      roles.length > 0
        ? plainStatement(
            'roles',
            'source_reported',
            `В публикациях сообщается об участии в ${snapshot.experience.projects.value} объектах: ${roles.map(([r, a]) => `${roleText(r)} — ${a.value}`).join(', ')}.`,
            snapshot.experience.participations.map(p => p.assertionId),
          )
        : plainStatement('roles', 'not_established', 'В собранной выборке участие компании в объектах не установлено.'),
    );
    const dated = snapshot.media.eventsDated12m.value ?? 0;
    const undated = snapshot.media.eventsUndated.value ?? 0;
    summary.push(
      snapshot.media.events.length > 0
        ? plainStatement(
            'events',
            'source_reported',
            `В публикациях сообщается о событиях с участием компании: с датой за 12 месяцев — ${dated}, без даты — ${undated}; дел, где компания истец или заявитель — ${snapshot.media.courtRoles.plaintiff}, ответчик или должник — ${snapshot.media.courtRoles.defendant}.`,
            snapshot.media.events.map(e => e.assertionId),
          )
        : plainStatement('events', 'not_established', 'В собранной выборке событий с участием компании не найдено — это не означает, что их не было.'),
    );
    limits.push(plainStatement('coverage', 'system_context', snapshot.identity.coverage.note));
    if (snapshot.media.publications.status === 'insufficient_data') limits.push(plainStatement('no_publications', 'not_established', 'Публикаций о компании в выборке нет — данных недостаточно для выводов.'));
    const legacy = snapshot.identity.coverage.legacyUnimported;
    if (legacy.participations + legacy.events > 0) {
      limits.push(plainStatement('legacy', 'system_context', `Старый разбор не перенесён в утверждения: ролей ${legacy.participations}, событий ${legacy.events}.`));
    }
  } else {
    limits.push(plainStatement('no_snapshot', 'not_established', refresh.active ? 'Компания появилась после среза сигналов — резюме будет после пересчёта.' : 'Сигналы ещё не рассчитывались.'));
  }
  if (refresh.stale && refresh.active) limits.push(plainStatement('stale', 'system_context', `Сигналы устарели: ${refresh.staleReasons.join('; ')}.`));

  const contracts = facts
    .filter(f => f.predicate === 'contract')
    .map(f =>
      factStatement(
        'contract',
        f,
        `${f.subjectCompanyName} → ${f.objectCompanyName}: ${roleText(f.role)}${f.polarity === 'negative' ? ' (отрицается)' : f.modality === 'planned' ? ' (план)' : f.modality === 'possible' ? ' (возможно)' : ''}`,
      ),
    );
  const corporate = facts
    .filter(f => f.predicate === 'corporate_relation' && fact(f))
    .map(f => factStatement('corporate', f, `${f.subjectCompanyName} — ${roleText(f.role)} ${f.objectCompanyName}`));

  const coParticipants = (
    await exec.query<{ companyId: number; companyName: string; projectId: number; projectName: string; roleOther: string | null; roleThis: string | null }>(
      `SELECT DISTINCT o.id AS "companyId", o.name AS "companyName", p.id AS "projectId", p.name AS "projectName",
              CASE WHEN v.company_a_id = $1 THEN v.role_b ELSE v.role_a END AS "roleOther",
              CASE WHEN v.company_a_id = $1 THEN v.role_a ELSE v.role_b END AS "roleThis"
       FROM co_participations_v v
       JOIN companies o ON o.id = CASE WHEN v.company_a_id = $1 THEN v.company_b_id ELSE v.company_a_id END AND o.merged_into_id IS NULL
       JOIN projects p ON p.id = v.project_id AND p.merged_into_id IS NULL
       WHERE $1 IN (v.company_a_id, v.company_b_id)
       ORDER BY p.name, o.name LIMIT 100`,
      [companyId],
    )
  ).rows;

  const cases = (
    await exec.query<{ id: number; title: string; status: string }>(
      'SELECT id, title, status FROM dossier_cases WHERE company_id = $1 OR claimed_client_company_id = $1 ORDER BY id DESC LIMIT 50',
      [companyId],
    )
  ).rows;

  return {
    generatedAt: now.toISOString(),
    signalsCutoff: refresh.active?.cutoffAt ?? null,
    stale: refresh.stale,
    staleReasons: refresh.staleReasons,
    summary,
    counterparties: { contracts, corporate, coParticipants },
    contradictions: await loadOpenQueue(exec, facts.map(f => f.assertionId)),
    limits,
    cases,
  };
};
