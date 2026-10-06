// Профиль чтения сайта компании (этап 25B, ADR-018): mode = 'company_site'.
//
// Профиль строится порталом при подтверждении сайта (companySites/sources.ts), а не пишется руками: в нём только
// главная страница и пределы. Как у реестра (ingest/registry/profile.ts), это режим профиля, а не вид источника:
// sources.kind = 'website', поэтому допуск, здоровье и журнал запусков работают без правок.

import { z } from 'zod';

import { DEFAULT_SOURCE_LIMITS, type ISourceNetworkPolicy } from '../../net/safeFetch.js';

export const COMPANY_SITE_PARSER_VERSION = 'company-site@1';

export const isCompanySiteConfig = (config: Record<string, unknown>): boolean => config.mode === 'company_site';

const limitsSchema = z
  .object({
    maxBytes: z.number().int().min(10_000).max(DEFAULT_SOURCE_LIMITS.maxBytes).default(3 * 1024 * 1024),
    timeoutMs: z.number().int().min(1000).max(60_000).default(20_000),
    // Пауза между страницами одного сайта: не меньше, чем у остальных источников (CLAUDE.md, «Ингест»).
    delayMs: z.number().int().min(4000).max(60_000).default(4000),
  })
  .strict();

export const companySiteProfileSchema = z
  .object({
    version: z.literal(1).default(1),
    mode: z.literal('company_site'),
    homepage: z
      .string()
      .url()
      .refine(value => /^https?:\/\//.test(value), { message: 'только http(s)' }),
    /** Главная и страницы проектов вместе. */
    maxPages: z.number().int().min(1).max(10).default(6),
    limits: limitsSchema.default({}),
  })
  .strict();

export type ICompanySiteProfile = z.infer<typeof companySiteProfileSchema>;

export class CompanySiteProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompanySiteProfileError';
  }
}

export const parseCompanySiteProfile = (config: Record<string, unknown>): ICompanySiteProfile => {
  const parsed = companySiteProfileSchema.safeParse(config);
  if (!parsed.success) {
    throw new CompanySiteProfileError(
      parsed.error.issues
        .slice(0, 5)
        .map(i => `${i.path.join('.') || 'профиль'}: ${i.message}`)
        .join('; '),
    );
  }
  return parsed.data;
};

/** Хост главной без «www.»: сайт и его поддомены — и больше ничего. */
export const siteHost = (homepage: string): string => new URL(homepage).hostname.toLowerCase().replace(/^www\./, '');

export const companySitePolicy = (profile: ICompanySiteProfile): ISourceNetworkPolicy => ({
  allowedHosts: [siteHost(profile.homepage)],
  allowSubdomains: true,
  maxBytes: profile.limits.maxBytes,
  timeoutMs: profile.limits.timeoutMs,
  maxRedirects: DEFAULT_SOURCE_LIMITS.maxRedirects,
});
