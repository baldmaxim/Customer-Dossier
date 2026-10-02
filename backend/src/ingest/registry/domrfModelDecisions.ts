// Решения модели по совпадениям компаний с записями ДОМ.РФ (02.10.2026, решение владельца; ADR-012 п. 33).
//
// Подсказка модели («скорее он / не он / не уверена», domrf-hint@1) раньше только стояла рядом с кнопками.
// Теперь с MODEL_REVIEW_APPLY она применяется — по каждой компании разом, потому что компании соответствует
// одна запись реестра (п. 31):
//   - реквизиты расходятся (у компании и у страницы застройщика разные ИНН) — «не он» правилом, без модели;
//   - ровно одна запись «скорее он» (или совпал ИНН) — «Это он»: остальные записи компании закрываются;
//   - ни одной «скорее он» — записи «скорее не он» отклоняются, «не уверена» ждут оператора;
//   - несколько «скорее он» — решает оператор.
// Решение оператора после подсказки — последнее слово: такие записи модель не трогает.
// Страницы, у которых не осталось подтверждённых записей, снимаются с чтения общим путём (п. 31), и
// поставленные с них в сбор и ещё не снятые объекты уходят вместе с ними.

import { env } from '../../config/env.js';
import { query } from '../../db/pool.js';
import { modelActor } from '../../resolve/modelReview.js';
import { DOMRF_HINT_PROMPT_VERSION } from '../../llm/domrfHint/prompt.js';
import { DomRfCompanyError, confirmDomRfCompanyLink, rejectDomRfCompanyLink } from './domrfCompanies.js';

export interface ILinkState {
  id: number;
  company_id: number;
  company_name: string;
  kind: string;
  external_ref: string;
  name: string | null;
  state: 'pending' | 'confirmed';
  verdict: 'match' | 'no_match' | 'unsure' | null;
  /** ИНН компании (действующий, с верной контрольной суммой) и страницы застройщика. */
  company_inn: string | null;
  card_inn: string | null;
  operator_after_hint: boolean;
}

export interface IDomRfModelDecision {
  companyId: number;
  companyName: string;
  linkId: number;
  record: string;
  action: 'confirm' | 'reject';
  reason: string;
  applied: boolean;
}

/** Компании с нерешёнными или подтверждёнными записями и подсказкой нынешней модели к каждой из них. */
const loadStates = async (): Promise<ILinkState[]> =>
  query<ILinkState>(
    `SELECT l.id, l.company_id, c.name AS company_name, l.kind, l.external_ref, coalesce(d.name, l.name) AS name, l.state,
            CASE WHEN l.hint_model = $1 AND l.hint_prompt_version = $2 THEN l.hint_verdict END AS verdict,
            (SELECT ei.value FROM entity_identifiers ei
              WHERE ei.company_id = c.id AND ei.status = 'active' AND ei.identifier_type = 'inn' AND ei.validation_status = 'checksum_valid'
              ORDER BY ei.id LIMIT 1) AS company_inn,
            d.inn AS card_inn,
            -- Решение оператора после подсказки — последнее слово. Подсказки ещё не было — решение прежнее,
            -- принятое без неё (по названию), и модель его пересматривает.
            (l.decided_by IS NOT NULL AND l.decided_by NOT LIKE 'model:%' AND l.decided_by <> 'auto'
              AND l.hinted_at IS NOT NULL AND l.decided_at > l.hinted_at) AS operator_after_hint
     FROM domrf_company_links l
     JOIN companies c ON c.id = l.company_id AND c.merged_into_id IS NULL
     LEFT JOIN domrf_cards d ON d.kind = l.kind AND d.external_ref = l.external_ref
     WHERE l.state IN ('pending', 'confirmed')
     ORDER BY l.company_id, l.id`,
    [env.LMSTUDIO_MODEL, DOMRF_HINT_PROMPT_VERSION],
  );

const recordText = (l: ILinkState): string => `${l.kind === 'group' ? 'группа' : 'застройщик'} «${l.name ?? l.external_ref}»`;

/** Чистая функция: что сделать с записями одной компании. Проверяется без базы. */
export const planCompanyDecisions = (links: readonly ILinkState[]): Array<Omit<IDomRfModelDecision, 'applied'>> => {
  // Оператор подтвердил запись после подсказки — компания решена им: «Это он» модели закрыл бы его выбор.
  if (links.some(l => l.operator_after_hint && l.state === 'confirmed')) return [];
  const open = links.filter(l => !l.operator_after_hint);
  if (open.length === 0) return [];
  const { company_id: companyId, company_name: companyName } = links[0]!;
  const out: Array<Omit<IDomRfModelDecision, 'applied'>> = [];
  const innConflict = (l: ILinkState): boolean => Boolean(l.company_inn && l.card_inn && l.company_inn !== l.card_inn);
  const innMatch = (l: ILinkState): boolean => Boolean(l.company_inn && l.card_inn && l.company_inn === l.card_inn);

  for (const l of open.filter(innConflict)) {
    out.push({ companyId, companyName, linkId: l.id, record: recordText(l), action: 'reject', reason: `ИНН компании ${l.company_inn} ≠ ИНН страницы ${l.card_inn} (правило)` });
  }
  const candidates = open.filter(l => !innConflict(l));
  const byInn = candidates.filter(innMatch);
  const matches = byInn.length > 0 ? byInn : candidates.filter(l => l.verdict === 'match');
  if (matches.length === 1) {
    const keep = matches[0]!;
    const others = links.filter(l => l.id !== keep.id && !innConflict(l));
    // «Это он» закрывает остальные записи компании — нужен, если запись ещё не подтверждена или рядом есть другие.
    if (keep.state !== 'confirmed' || others.length > 0) {
      out.push({
        companyId,
        companyName,
        linkId: keep.id,
        record: recordText(keep),
        action: 'confirm',
        reason: innMatch(keep) ? `ИНН совпал: ${keep.card_inn}` : 'модель: скорее он; остальные записи компании закрываются',
      });
    }
    return out;
  }
  if (matches.length === 0) {
    for (const l of candidates.filter(l => l.verdict === 'no_match')) {
      out.push({ companyId, companyName, linkId: l.id, record: recordText(l), action: 'reject', reason: 'модель: скорее не он' });
    }
  }
  return out;
};

/** Один проход по всем компаниям. apply=false — только план («что решила бы модель»). */
export const applyDomRfModelDecisions = async (apply: boolean = env.MODEL_REVIEW_APPLY): Promise<IDomRfModelDecision[]> => {
  const states = await loadStates();
  const byCompany = new Map<number, ILinkState[]>();
  for (const s of states) byCompany.set(s.company_id, [...(byCompany.get(s.company_id) ?? []), s]);

  const decisions: IDomRfModelDecision[] = [];
  const actor = modelActor();
  for (const links of byCompany.values()) {
    for (const plan of planCompanyDecisions(links)) {
      let applied = false;
      if (apply) {
        try {
          if (plan.action === 'confirm') await confirmDomRfCompanyLink(plan.linkId, actor);
          else await rejectDomRfCompanyLink(plan.linkId, actor);
          applied = true;
        } catch (err) {
          // Запись успели решить (закрыта выбором другой записи той же компании) — это не ошибка прохода.
          if (!(err instanceof DomRfCompanyError)) throw err;
        }
      }
      decisions.push({ ...plan, applied });
    }
  }
  return decisions;
};
