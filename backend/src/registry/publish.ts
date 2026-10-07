// Запись реестра → канон, без модели (этап 20B).
//
// Что сюда попадает и что не попадает — граница проведена по одному признаку:
// в канон идёт только то, что не меняется от снимка к снимку. Объект, юрлицо
// застройщика с реквизитом, роль застройщика и связь с группой компаний — да.
// Сроки, цена, распроданность, стадия банкротства — нет: конвейер умеет
// добавлять утверждения и не умеет их отзывать, а эти значения меняются.
// Они остаются снимком на дату (registry_records) и показываются с датой.
//
// Каждое утверждение опирается на строку текста той же редакции. Строка
// собирается теми же функциями рендера, что её и написали, и ищется в тексте
// целиком: не нашлась однозначно — утверждение не пишется. Молчаливой
// публикации «примерно той же» цитаты здесь нет.

import type { PoolClient } from 'pg';

import { addEvidence, upsertAssertion } from '../assertions/repository.js';
import type { IAssertionContent } from '../assertions/model.js';
import { locateQuote, sliceByCodePoints } from '../assertions/span.js';
import type { IRegistryRecord } from '../ingest/registry/map.js';
import { companyTitle, developerLine, groupLine, requisitesLine } from '../ingest/registry/render.js';
import { lockCanonWrites } from '../resolve/canonLock.js';
import { resolveCompany } from '../resolve/company.js';
import { addIdentifier, classifyTaxId } from '../resolve/identifiers.js';
import { resolveProject } from '../resolve/project.js';
import { linkedRegistryProject } from './projectLink.js';

export const REGISTRY_PUBLISH_VERSION = 'registry-publish@1';

export interface IRegistrySkip {
  what: string;
  reason: string;
}

export interface IRegistryPublishOutcome {
  projectId: number | null;
  companyId: number | null;
  groupCompanyId: number | null;
  assertions: number;
  skipped: IRegistrySkip[];
}

export interface IRegistryPublishInput {
  revisionId: number;
  /** Текст той самой редакции: цитаты проверяются по нему, и база сверит их ещё раз. */
  body: string;
  record: IRegistryRecord;
  requestedProjectId?: number;
}

const participation = (companyId: number, projectId: number): IAssertionContent => ({
  predicate: 'participates_in_project',
  role: 'developer',
  eventType: null,
  subjectCompanyId: companyId,
  subjectProjectId: null,
  subjectText: null,
  objectCompanyId: null,
  objectProjectId: projectId,
  objectText: null,
  counterpartyCompanyId: null,
  scopeBuilding: null,
  workPackage: null,
  validFrom: null,
  validTo: null,
  periodPrecision: 'unknown',
  modality: 'reported_fact',
  valueType: null,
  valueNumeric: null,
  valueCurrency: null,
  polarity: 'positive',
});

export const memberOfGroup = (companyId: number, groupId: number): IAssertionContent => ({
  predicate: 'corporate_relation',
  role: 'member_of_group',
  eventType: null,
  subjectCompanyId: companyId,
  subjectProjectId: null,
  subjectText: null,
  objectCompanyId: groupId,
  objectProjectId: null,
  objectText: null,
  counterpartyCompanyId: null,
  scopeBuilding: null,
  workPackage: null,
  validFrom: null,
  validTo: null,
  periodPrecision: 'unknown',
  modality: 'reported_fact',
  valueType: null,
  valueNumeric: null,
  valueCurrency: null,
  polarity: 'positive',
});

/**
 * Утверждение реестра со строкой-основанием из текста редакции. Строка не нашлась однозначно — false,
 * утверждения нет. Повтор той же строки не плодит доказательств (снятое — возвращается, addEvidence).
 */
export const writeRegistryAssertion = async (
  client: PoolClient,
  input: { revisionId: number; body: string; content: IAssertionContent; line: string },
): Promise<boolean> => {
  const found = locateQuote(input.body, input.line);
  const span = found.kind === 'unique' ? sliceByCodePoints(input.body, found.span) : null;
  if (!span) return false;
  const assertion = await upsertAssertion(client, input.content, { origin: 'registry', confidenceExtraction: null, confidenceIdentity: null });
  await addEvidence(client, {
    assertionId: assertion.id,
    revisionId: input.revisionId,
    stance: 'supports',
    span,
    origin: 'registry',
    extractionId: null,
    legacyKind: null,
    legacyId: null,
  });
  return true;
};

/**
 * Компания портала для страницы группы ДОМ.РФ — та, что подтверждена как эта группа («Это он» оператора
 * или модели). Подтверждена за несколько компаний или ни за одну — null: группу без реквизитов по
 * названию не угадываем — ДОНСТРОЙ из Москвы и «Донстрой» из Ростова — разные группы с одним именем
 * (02.10.2026, ADR-012 п. 33).
 */
export const confirmedDomRfGroupCompany = async (client: PoolClient, groupRef: string | null): Promise<number | null> => {
  if (!groupRef) return null;
  const rows = (
    await client.query<{ id: string }>(
      `SELECT DISTINCT coalesce(c.merged_into_id, c.id) AS id
       FROM domrf_company_links l JOIN companies c ON c.id = l.company_id
       WHERE l.kind = 'group' AND l.external_ref = $1 AND l.state = 'confirmed'`,
      [groupRef],
    )
  ).rows;
  return rows.length === 1 ? Number(rows[0]!.id) : null;
};

/** Страница группы ДОМ.РФ для снимка со страницы сайта — по странице его застройщика (domrf_cards.group_ref). */
export const domRfGroupRefOf = async (client: PoolClient, record: IRegistryRecord): Promise<string | null> => {
  const cardRef = record.payload.developerCardRef;
  const developerRef = record.type === 'developer' ? record.identity.externalRef : typeof cardRef === 'string' ? cardRef : null;
  if (!developerRef) return null;
  return (
    (await client.query<{ group_ref: string | null }>(`SELECT group_ref FROM domrf_cards WHERE kind = 'developer' AND external_ref = $1`, [developerRef]))
      .rows[0]?.group_ref ?? null
  );
};

/**
 * Публикация записи реестра. Вызывается в той же транзакции, что и запись
 * редакции и снимка: канон не должен ссылаться на редакцию, которой нет.
 */
export const publishRegistryRecord = async (client: PoolClient, input: IRegistryPublishInput): Promise<IRegistryPublishOutcome> => {
  // Застройщик, объект и группа заводятся тем же резолвером, что и публикация разбора, — под той же блокировкой,
  // первой командой транзакции (resolve/canonLock.ts): иначе одновременная публикация разбора заводит дубль.
  await lockCanonWrites(client);
  const { record, body, revisionId } = input;
  const out: IRegistryPublishOutcome = { projectId: null, companyId: null, groupCompanyId: null, assertions: 0, skipped: [] };

  const write = async (content: IAssertionContent, line: string, what: string): Promise<void> => {
    if (!(await writeRegistryAssertion(client, { revisionId, body, content, line }))) {
      out.skipped.push({ what, reason: 'строка-основание не найдена в тексте редакции однозначно' });
      return;
    }
    out.assertions += 1;
  };

  const developer = record.identity.developer;
  if (!developer) {
    out.skipped.push({
      what: 'застройщик',
      reason: record.payload.captureMethod === 'browser_page'
        ? 'на странице объекта нет реквизитов застройщика; имя сохранено в тексте снимка'
        : 'в записи реестра застройщик не назван',
    });
  } else {
    const title = companyTitle(developer.name, developer.legalForm);
    const resolved = await resolveCompany(client, {
      surface: title,
      legalForm: developer.legalForm,
      taxId: developer.inn ?? developer.ogrn,
      city: record.identity.city,
      revisionId,
      identifierOrigin: 'registry',
    });
    if (!resolved) {
      out.skipped.push({ what: 'застройщик', reason: `название «${title}» не годится для идентификации компании` });
    } else {
      out.companyId = resolved.companyId;
      // Второй реквизит (ОГРН рядом с ИНН) добавляется отдельно: резолвер принимает один.
      for (const raw of [developer.inn, developer.ogrn]) {
        const typed = raw ? classifyTaxId(raw) : null;
        if (typed) await addIdentifier(client, { ...typed, companyId: resolved.companyId, origin: 'registry', sourceRevisionId: revisionId, createdBy: 'registry' });
      }
    }
  }

  if (record.type === 'object') {
    const source = (await client.query<{ source_id: number }>(
      'SELECT source_id FROM registry_records WHERE revision_id = $1', [revisionId],
    )).rows[0];
    const linkedId = source ? await linkedRegistryProject(
      client, source.source_id, record.identity.externalRef, input.requestedProjectId,
    ) : null;
    const project = linkedId === null ? await resolveProject(client, {
      surface: record.identity.name,
      kind: record.projectKind,
      city: record.identity.city,
      address: record.identity.address,
      relatedCompanyIds: out.companyId === null ? [] : [out.companyId],
      revisionId,
    }) : { projectId: linkedId };
    if (!project) {
      out.skipped.push({ what: 'объект', reason: `название «${record.identity.name}» не годится для идентификации объекта` });
    } else {
      out.projectId = project.projectId;
      if (out.companyId !== null && developer) {
        await write(
          participation(out.companyId, project.projectId),
          developerLine(record.identity.name, companyTitle(developer.name, developer.legalForm), developer.inn, developer.ogrn),
          'роль застройщика на объекте',
        );
      }
    }
  }

  const groupName = record.identity.groupName;
  if (groupName && out.companyId !== null && developer) {
    const title = companyTitle(developer.name, developer.legalForm);
    // Страница сайта ДОМ.РФ: группа — компания, подтверждённая для страницы группы, а не одноимённая
    // (ADR-012 п. 33). Запись API-профиля: группа — имя без реквизитов, резолвер не прикрепит его к
    // одноимённому юрлицу (ADR-005).
    const browser = record.payload.captureMethod === 'browser_page';
    const groupId = browser
      ? await confirmedDomRfGroupCompany(client, await domRfGroupRefOf(client, record))
      : ((await resolveCompany(client, { surface: groupName, revisionId }))?.companyId ?? null);
    if (groupId === null) {
      out.skipped.push({
        what: 'группа компаний',
        reason: browser
          ? 'страница группы ДОМ.РФ не сопоставлена с компанией портала — связь появится после «Это он» по группе'
          : `название «${groupName}» не годится для идентификации`,
      });
    } else if (groupId === out.companyId) {
      out.skipped.push({ what: 'группа компаний', reason: 'группа и застройщик распознаны как одна компания' });
    } else {
      out.groupCompanyId = groupId;
      await write(memberOfGroup(out.companyId, groupId), groupLine(title, groupName), 'принадлежность к группе компаний');
    }
  }

  // Реквизиты в карточке самого застройщика: строка есть, но отдельного утверждения
  // она не порождает — реквизит живёт в entity_identifiers, а не в assertions.
  if (record.type === 'developer' && developer && requisitesLine(companyTitle(developer.name, developer.legalForm), developer.inn, developer.ogrn) === null) {
    out.skipped.push({ what: 'реквизиты', reason: 'в записи реестра нет ни ИНН, ни ОГРН' });
  }

  await client.query(
    `UPDATE registry_records SET project_id = coalesce($2, project_id), company_id = coalesce($3, company_id) WHERE revision_id = $1`,
    [revisionId, out.projectId, out.companyId],
  );
  return out;
};
