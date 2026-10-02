// Сверка «застройщик входит в группу» из ДОМ.РФ (02.10.2026, ADR-012 п. 33).
//
// Группа на ДОМ.РФ — страница без реквизитов. Прежде группа находилась по названию, и одноимённые группы
// склеивались в одну компанию портала: московская «ДОНСТРОЙ» и ростовская «Донстрой» стали одной
// карточкой, а связи её СЗ не доходили до той «Донстрой», которую оператор подтвердил как эту группу.
// Теперь группа — компания, подтверждённая для страницы группы («Это он» оператора или модели).
//
// Проход идёт по последнему снимку каждой прочитанной страницы застройщика:
//  - связь с другой компанией, чем подтверждённая для его группы, снимается (доказательство реестра →
//    superseded: снимается только вклад реестра, решения аналитика и чужие доказательства остаются);
//  - связи с подтверждённой нет — записывается с цитатой из того же снимка («Застройщик … входит в группу …»).
// Группа ни за кем не подтверждена — прежние связи не трогаются (угадывать нечем, а снять — значит потерять),
// кроме связи с компанией, для которой эту группу явно отклонили («не он» оператора или модели).
// Повтор безопасен: второй проход ничего не меняет.

import type { PoolClient } from 'pg';

import { withTransaction } from '../db/pool.js';
import { companyTitle, groupLine } from '../ingest/registry/render.js';
import { confirmedDomRfGroupCompany, memberOfGroup, writeRegistryAssertion } from './publish.js';

export const GROUP_SYNC_REASON = 'группа ДОМ.РФ подтверждена за другой компанией портала';
export const GROUP_REJECTED_REASON = 'группа ДОМ.РФ отклонена для этой компании портала («не он»)';

export interface IGroupSyncResult {
  /** Связей записано с подтверждённой группой. */
  linked: number;
  /** Связей с другой компанией снято. */
  withdrawn: number;
}

interface IDeveloperRow {
  dev_ref: string;
  company_id: string;
  revision_id: string;
  group_ref: string | null;
  dev_name: string;
  legal_form: string | null;
  group_name: string | null;
  body: string;
}

const syncOne = async (client: PoolClient, row: IDeveloperRow): Promise<IGroupSyncResult> => {
  const companyId = Number(row.company_id);
  const target = await confirmedDomRfGroupCompany(client, row.group_ref);
  if (target === null) {
    if (!row.group_ref) return { linked: 0, withdrawn: 0 };
    const rejected = await client.query(
      `UPDATE evidence e SET status = 'superseded', status_reason = $3, status_changed_at = now()
       FROM assertions a
       WHERE e.assertion_id = a.id AND e.origin = 'registry' AND e.status = 'active'
         AND a.origin = 'registry' AND a.predicate = 'corporate_relation' AND a.role = 'member_of_group'
         AND a.subject_company_id = $1
         AND EXISTS (SELECT 1 FROM domrf_company_links l JOIN companies c ON c.id = l.company_id
                     WHERE l.kind = 'group' AND l.external_ref = $2 AND l.state = 'rejected'
                       AND coalesce(c.merged_into_id, c.id) = a.object_company_id)`,
      [companyId, row.group_ref, GROUP_REJECTED_REASON],
    );
    return { linked: 0, withdrawn: rejected.rowCount ?? 0 };
  }
  if (target === companyId) return { linked: 0, withdrawn: 0 };

  const withdrawn = await client.query(
    `UPDATE evidence e SET status = 'superseded', status_reason = $3, status_changed_at = now()
     FROM assertions a
     WHERE e.assertion_id = a.id AND e.origin = 'registry' AND e.status = 'active'
       AND a.origin = 'registry' AND a.predicate = 'corporate_relation' AND a.role = 'member_of_group'
       AND a.subject_company_id = $1 AND a.object_company_id <> $2`,
    [companyId, target, GROUP_SYNC_REASON],
  );

  const present = (
    await client.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM assertions a JOIN evidence e ON e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports'
         WHERE a.origin = 'registry' AND a.predicate = 'corporate_relation' AND a.role = 'member_of_group'
           AND a.subject_company_id = $1 AND a.object_company_id = $2 AND a.status <> 'rejected') AS present`,
      [companyId, target],
    )
  ).rows[0]?.present;
  let linked = 0;
  if (!present && row.group_name) {
    const written = await writeRegistryAssertion(client, {
      revisionId: Number(row.revision_id),
      body: row.body,
      content: memberOfGroup(companyId, target),
      line: groupLine(companyTitle(row.dev_name, row.legal_form), row.group_name),
    });
    if (written) linked = 1;
  }
  return { linked, withdrawn: withdrawn.rowCount ?? 0 };
};

/** Один проход по всем прочитанным страницам застройщиков; каждая — своей транзакцией. */
export const syncDomRfGroupRelations = async (): Promise<IGroupSyncResult> => {
  const rows = await withTransaction(async client =>
    (
      await client.query<IDeveloperRow>(
        `SELECT DISTINCT ON (r.external_ref)
                r.external_ref AS dev_ref, coalesce(c.merged_into_id, c.id) AS company_id, r.revision_id, d.group_ref,
                r.payload->'identity'->>'name' AS dev_name,
                r.payload->'identity'->'developer'->>'legalForm' AS legal_form,
                r.payload->'identity'->>'groupName' AS group_name,
                rev.body
         FROM registry_records r
         JOIN companies c ON c.id = r.company_id
         JOIN domrf_cards d ON d.kind = 'developer' AND d.external_ref = r.external_ref
         JOIN document_revisions rev ON rev.id = r.revision_id
         WHERE r.record_type = 'developer' AND r.payload->>'captureMethod' = 'browser_page'
         ORDER BY r.external_ref, r.fetched_at DESC`,
      )
    ).rows,
  );
  const total: IGroupSyncResult = { linked: 0, withdrawn: 0 };
  for (const row of rows) {
    const result = await withTransaction(client => syncOne(client, row));
    total.linked += result.linked;
    total.withdrawn += result.withdrawn;
  }
  return total;
};
