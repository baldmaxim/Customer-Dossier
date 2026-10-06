// Схема ответа модели для проектов со страницы сайта компании (site-projects@1, этап 25B).
//
// strict: true требует все свойства в required и additionalProperties: false, nullable — как ["string","null"]
// (см. TG_Info/CLAUDE.md). maxItems в строгой схеме держат не все хостинги — предел режется на приёме.

import { z } from 'zod';

export const SITE_PROJECTS_SCHEMA_VERSION = 'site-projects-schema@1';

export const SITE_PROJECT_STATUSES = ['selling', 'construction', 'completed', 'planned', 'unknown'] as const;
export type SiteProjectStatus = (typeof SITE_PROJECT_STATUSES)[number];

/** Проектов со страницы: больше — каталог с карточками квартир, а не список ЖК. */
export const SITE_PROJECTS_MAX = 40;

const nullableText = { type: ['string', 'null'] } as const;

export const SITE_PROJECTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['projects'],
  properties: {
    projects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'city', 'address', 'status', 'completion', 'quote'],
        properties: {
          name: { type: 'string', description: 'Название проекта как в тексте' },
          city: { ...nullableText, description: 'Город, если написан рядом с проектом, иначе null' },
          address: { ...nullableText, description: 'Адрес или район, если написан рядом с проектом, иначе null' },
          status: { type: 'string', enum: [...SITE_PROJECT_STATUSES] },
          completion: { ...nullableText, description: 'Срок сдачи как написан («IV кв. 2027»), иначе null' },
          quote: { type: 'string', description: 'Дословный фрагмент текста страницы с названием проекта' },
        },
      },
    },
  },
} as const;

export interface ISiteProject {
  name: string;
  city: string | null;
  address: string | null;
  status: SiteProjectStatus;
  completion: string | null;
  quote: string;
}

export interface ISiteProjects {
  projects: ISiteProject[];
}

/** Пустая строка, «null», «неизвестно» — это null: модель иногда пишет заглушку вместо null. */
const orNull = (value: string | null): string | null => {
  const flat = value?.replace(/\s+/g, ' ').trim() ?? '';
  return flat === '' || /^(null|none|нет|неизвестно|не указан[оа]?|-|—)$/i.test(flat) ? null : flat;
};

export const siteProjectsSchema = z
  .object({
    projects: z.array(
      z.object({
        name: z.string(),
        city: z.string().nullable(),
        address: z.string().nullable(),
        status: z.enum(SITE_PROJECT_STATUSES),
        completion: z.string().nullable(),
        quote: z.string(),
      }),
    ),
  })
  .transform(value => ({
    projects: value.projects
      .map(p => ({
        name: p.name.replace(/\s+/g, ' ').trim(),
        city: orNull(p.city),
        address: orNull(p.address),
        status: p.status,
        completion: orNull(p.completion),
        quote: p.quote.trim(),
      }))
      .filter(p => p.name !== '' && p.quote !== '')
      .slice(0, SITE_PROJECTS_MAX),
  }));
