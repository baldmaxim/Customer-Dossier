// Схема ответа модели для поиска официального сайта компании (site-search@1).
//
// strict: true требует все свойства в required и additionalProperties: false, nullable — как ["string","null"]
// (см. TG_Info/CLAUDE.md). maxItems в строгой схеме держат не все хостинги — предел режется на приёме.

import { z } from 'zod';

/** Сколько адресов принимаем от модели: дальше — шум, оператору разбирать нечего. */
export const SITE_SEARCH_SITES_MAX = 3;

/** Объяснение — одна фраза под адресом; длиннее обрезается по слову. */
export const SITE_SEARCH_REASON_MAX = 240;

export const SITE_SEARCH_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sites', 'none_reason'],
  properties: {
    sites: {
      type: 'array',
      description: 'До трёх адресов собственного сайта компании или её группы — только из результатов поиска',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'reason'],
        properties: {
          url: { type: 'string', description: 'Адрес страницы из результатов поиска, как есть' },
          reason: { type: 'string', description: 'Почему это сайт компании, одна короткая фраза по-русски' },
        },
      },
    },
    none_reason: { type: ['string', 'null'], description: 'Если подходящего сайта нет — почему, одной фразой; иначе null' },
  },
} as const;

export interface ISiteSearchSite {
  url: string;
  reason: string;
}

export interface ISiteSearch {
  sites: ISiteSearchSite[];
  noneReason: string | null;
}

const trimText = (raw: string, max: number): string => {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

export const siteSearchSchema = z
  .object({
    sites: z.array(z.object({ url: z.string(), reason: z.string() })),
    none_reason: z.string().nullable(),
  })
  .transform(value => ({
    sites: value.sites
      .map(site => ({ url: site.url.trim(), reason: trimText(site.reason, SITE_SEARCH_REASON_MAX) }))
      .filter(site => site.url !== '')
      .slice(0, SITE_SEARCH_SITES_MAX),
    noneReason: value.none_reason === null || value.none_reason.trim() === '' ? null : trimText(value.none_reason, SITE_SEARCH_REASON_MAX),
  }));
