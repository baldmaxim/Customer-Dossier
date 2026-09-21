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
import { locateQuote, sliceByCodePoints, type IEvidenceSpan } from '../assertions/span.js';
import type { IRegistryRecord } from '../ingest/registry/map.js';
import { companyTitle, developerLine, groupLine, requisitesLine } from '../ingest/registry/render.js';
import { resolveCompany } from '../resolve/company.js';
import { addIdentifier, classifyTaxId } from '../resolve/identifiers.js';
import { resolveProject } from '../resolve/project.js';

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

const memberOfGroup = (companyId: number, groupId: number): IAssertionContent => ({
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
 * Публикация записи реестра. Вызывается в той же транзакции, что и запись
 * редакции и снимка: канон не должен ссылаться на редакцию, которой нет.
 */
export const publishRegistryRecord = async (client: PoolClient, input: IRegistryPublishInput): Promise<IRegistryPublishOutcome> => {
  const { record, body, revisionId } = input;
  const out: IRegistryPublishOutcome = { projectId: null, companyId: null, groupCompanyId: null, assertions: 0, skipped: [] };

  /** Цитата — целая строка рендера. Не нашлась однозначно — утверждения не будет. */
  const span = (line: string): IEvidenceSpan | null => {
    const found = locateQuote(body, line);
    return found.kind === 'unique' ? sliceByCodePoints(body, found.span) : null;
  };

  const write = async (content: IAssertionContent, line: string, what: string): Promise<void> => {
    const located = span(line);
    if (!located) {
      out.skipped.push({ what, reason: 'строка-основание не найдена в тексте редакции однозначно' });
      return;
    }
    const assertion = await upsertAssertion(client, content, { origin: 'registry', confidenceExtraction: null, confidenceIdentity: null });
    await addEvidence(client, {
      assertionId: assertion.id,
      revisionId,
      stance: 'supports',
      span: located,
      origin: 'registry',
      extractionId: null,
      legacyKind: null,
      legacyId: null,
    });
    out.assertions += 1;
  };

  const developer = record.identity.developer;
  if (!developer) {
    out.skipped.push({ what: 'застройщик', reason: 'в записи реестра застройщик не назван' });
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

  if (record.type === 'object' && out.companyId !== null && developer) {
    const project = await resolveProject(client, {
      surface: record.identity.name,
      kind: record.projectKind,
      city: record.identity.city,
      address: record.identity.address,
      relatedCompanyIds: [out.companyId],
      revisionId,
    });
    if (!project) {
      out.skipped.push({ what: 'объект', reason: `название «${record.identity.name}» не годится для идентификации объекта` });
    } else {
      out.projectId = project.projectId;
      await write(
        participation(out.companyId, project.projectId),
        developerLine(record.identity.name, companyTitle(developer.name, developer.legalForm), developer.inn, developer.ogrn),
        'роль застройщика на объекте',
      );
    }
  }

  const groupName = record.identity.groupName;
  if (groupName && out.companyId !== null && developer) {
    const title = companyTitle(developer.name, developer.legalForm);
    // Группа компаний — имя без реквизитов: резолвер не прикрепит его к одноимённому юрлицу (ADR-005).
    const group = await resolveCompany(client, { surface: groupName, revisionId });
    if (!group) {
      out.skipped.push({ what: 'группа компаний', reason: `название «${groupName}» не годится для идентификации` });
    } else if (group.companyId === out.companyId) {
      out.skipped.push({ what: 'группа компаний', reason: 'группа и застройщик распознаны как одна компания' });
    } else {
      out.groupCompanyId = group.companyId;
      await write(memberOfGroup(out.companyId, group.companyId), groupLine(title, groupName), 'принадлежность к группе компаний');
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
