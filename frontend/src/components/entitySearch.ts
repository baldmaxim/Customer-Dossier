// Поиск компаний и объектов для полей выбора (EntityPickers): запросы и строка сведений под
// названием — вид, реквизиты, город, одноимённые. Выбор осознанный: первая строка не подставляется.

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '../api/client';
import type { ICompanySearchItem, IProjectSearchItem } from '../api/types';
import { formatCount } from '../lib/format';
import { ENTITY_TYPE_LABELS, NO_IDENTIFIERS_TEXT, PROJECT_LEVEL_LABELS, identifierStringText } from '../lib/labels';
import { shortenLegalForm } from '../lib/legalForm';

export interface IEntityRef {
  kind: 'company' | 'project';
  id: number;
  name: string;
}

export interface IEntityOption {
  entity: IEntityRef;
  /** Название в списке: форма собственности — сокращённо («ООО»), полное — в entity.name. */
  title: string;
  /** Строка под названием: чем эта запись отличается от одноимённых. */
  meta: string;
}

/** «inn 7701045732» → «ИНН 7701045732» — общей подписью реквизитов (labels.ts). */
export const identifierText = identifierStringText;

export const companyOption = (c: ICompanySearchItem): IEntityOption => ({
  entity: { kind: 'company', id: c.id, name: c.name },
  title: shortenLegalForm(c.name),
  meta: [
    c.entityType && c.entityType !== 'unknown' ? ENTITY_TYPE_LABELS[c.entityType] : null,
    c.city,
    c.identifiers && c.identifiers.length > 0 ? c.identifiers.map(identifierText).join(', ') : NO_IDENTIFIERS_TEXT,
    c.projects !== null && c.projects !== undefined ? `объектов: ${formatCount(c.projects)}` : null,
    c.matchedAlias ? `найдено по написанию «${c.matchedAlias}»` : null,
    c.homonyms ? `одноимённых: ${formatCount(c.homonyms)} — сверьте ИНН` : null,
  ]
    .filter(Boolean)
    .join(' · '),
});

export const projectOption = (p: IProjectSearchItem): IEntityOption => ({
  entity: { kind: 'project', id: p.id, name: p.name },
  title: p.name,
  meta: [
    `${PROJECT_LEVEL_LABELS[p.level] ?? 'объект'}${p.levelLabel ? ` ${p.levelLabel}` : ''}`,
    p.city ?? 'город не указан',
    p.parentName ? `входит в «${p.parentName}»` : null,
    p.children > 0 ? `очередей и корпусов: ${formatCount(p.children)}` : null,
  ]
    .filter(Boolean)
    .join(' · '),
});

/** Искать от двух знаков: по одной букве совпадает полбазы. */
export const MIN_QUERY = 2;

export const useCompanySearch = (q: string, enabled = true): UseQueryResult<{ items: ICompanySearchItem[] }> =>
  useQuery({
    queryKey: ['picker', 'companies', q],
    queryFn: () => api.get<{ items: ICompanySearchItem[] }>(`/api/companies?q=${encodeURIComponent(q)}&limit=10`),
    enabled: enabled && q.length >= MIN_QUERY,
  });

export const useProjectSearch = (q: string, enabled = true): UseQueryResult<{ items: IProjectSearchItem[] }> =>
  useQuery({
    queryKey: ['picker', 'projects', q],
    queryFn: () => api.get<{ items: IProjectSearchItem[] }>(`/api/projects/search?q=${encodeURIComponent(q)}&limit=10`),
    enabled: enabled && q.length >= MIN_QUERY,
  });
