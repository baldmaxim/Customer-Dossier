// Профиль сайта-источника (этап 05A): типизированный и проверяемый конфиг адаптера.
//
// В профиле только данные: адреса, CSS-селекторы, лимиты, правила дат и канонических
// ссылок. Никакого JS, регулярных выражений из настроек, eval или shell — неизвестные
// ключи отвергаются. Селектор — строка для cheerio, он ничего не исполняет.

import { z } from 'zod';

import { DEFAULT_SOURCE_LIMITS, type ISourceNetworkPolicy } from '../../net/safeFetch.js';
import { sourceProfileMetaSchema } from '../profileMeta.js';

/** Версия правил разбора: меняется при правке парсеров, пишется в запуск и наблюдение. */
export const SITE_PARSER_VERSION = 'site@1';

const selector = z
  .string()
  .trim()
  .min(1)
  .max(300)
  // Селектор, а не код: фигурные скобки, открывающая угловая и обратные кавычки — признак разметки/скрипта.
  // Комбинатор потомка «>» допустим.
  .refine(v => !/[{}<`]/.test(v), 'недопустимые символы в селекторе');

const hostName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+(xn--[a-z0-9-]{2,59}|[a-z]{2,63})$/, 'имя хоста');

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine(v => /^https?:\/\//i.test(v), 'только http/https');

const listSchema = z
  .object({
    itemSelector: selector,
    linkSelector: selector.optional(),
    titleSelector: selector.optional(),
    dateSelector: selector.optional(),
    /** Атрибут с датой (datetime у <time>). Пусто — текст узла. */
    dateAttribute: z.string().trim().max(40).optional(),
    teaserSelector: selector.optional(),
  })
  .strict();

const articleSchema = z
  .object({
    bodySelector: selector,
    titleSelector: selector.optional(),
    dateSelector: selector.optional(),
    dateAttribute: z.string().trim().max(40).optional(),
    /** Блоки, которые не являются текстом статьи (подписи, «читайте также»). */
    removeSelectors: z.array(selector).max(20).default([]),
    /** Признак обрезанного текста (платный доступ, «читать полностью в приложении»). */
    truncatedSelector: selector.optional(),
  })
  .strict();

const projectCardSchema = z
  .object({
    /** Страницы карточек объектов — полные адреса на хосте источника. */
    urls: z.array(httpUrl).min(1).max(200),
    nameSelector: selector,
    /** Пары «подпись — значение» (dt/dd, строки таблицы): селектор строки и ячеек. */
    fieldRowSelector: selector,
    fieldLabelSelector: selector,
    fieldValueSelector: selector,
  })
  .strict();

export const siteProfileSchema = z
  .object({
    version: z.literal(1).default(1),
    mode: z.enum(['rss', 'html_list']),
    /** Дополнительные хосты кроме хоста base_url (например, cdn статей). */
    allowedHosts: z.array(hostName).max(10).default([]),
    rss: httpUrl.optional(),
    /**
     * Явный контракт источника: content:encoded в ленте содержит полный текст.
     * Без него текст ленты — анонс или «неизвестно», и статья догружается со страницы.
     */
    rssContentIsFull: z.boolean().default(false),
    startUrls: z.array(httpUrl).max(5).default([]),
    list: listSchema.optional(),
    pagination: z
      .object({
        nextSelector: selector,
        maxPages: z.number().int().min(1).max(50).default(3),
      })
      .strict()
      .optional(),
    article: articleSchema.optional(),
    projectCards: projectCardSchema.optional(),
    canonical: z
      .object({
        /** Дополнительно отбрасываемые параметры (кроме известных utm/yclid…). Остальные сохраняются. */
        dropQueryParams: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
      })
      .strict()
      .default({}),
    dates: z
      .object({
        /** Зона для дат без зоны. Правило явное: дата «12.09.2026 10:00» — это время источника. */
        timezone: z.enum(['Europe/Moscow', 'Europe/Kaliningrad', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Almaty', 'UTC']).default('Europe/Moscow'),
      })
      .strict()
      .default({}),
    /** Перезапрашивать уже известные статьи, чтобы заметить правки (дороже по запросам). */
    refetchKnown: z.boolean().default(false),
    limits: z
      .object({
        maxItemsPerRun: z.number().int().min(1).max(200).default(20),
        maxBytes: z.number().int().min(10_000).max(DEFAULT_SOURCE_LIMITS.maxBytes).default(DEFAULT_SOURCE_LIMITS.maxBytes),
        timeoutMs: z.number().int().min(1000).max(60_000).default(DEFAULT_SOURCE_LIMITS.timeoutMs),
        delayMs: z.number().int().min(0).max(60_000).default(4000),
      })
      .strict()
      .default({}),
    /** Сколько записей на странице списка ожидается минимум; меньше — подозрение на смену вёрстки. */
    expectations: z
      .object({ minItemsOnList: z.number().int().min(0).max(100).default(1) })
      .strict()
      .default({}),
    /** Этап 16: контракт подключения (source-profile@1). Допуск не выдаёт. */
    meta: sourceProfileMetaSchema.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.mode === 'html_list' && (!p.list || p.startUrls.length === 0)) {
      ctx.addIssue({ code: 'custom', message: 'html_list требует list и startUrls' });
    }
  });

export type ISiteProfile = z.infer<typeof siteProfileSchema>;

export class SiteProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteProfileError';
  }
}

/**
 * Профиль из sources.config. Старый конфиг этапа 01 ({rss, articleSelector}) приводится к
 * режиму rss; listSelector без профиля больше не считается рабочим путём.
 */
export const parseSiteProfile = (config: Record<string, unknown>): ISiteProfile => {
  const raw: Record<string, unknown> = { ...config };
  if (raw.mode === undefined) {
    if (raw.listSelector !== undefined) {
      throw new SiteProfileError('listSelector без профиля html_list не поддерживается: задайте mode, startUrls и list');
    }
    raw.mode = 'rss';
    if (typeof raw.articleSelector === 'string') raw.article = { bodySelector: raw.articleSelector };
    delete raw.articleSelector;
    delete raw.section;
  }
  const parsed = siteProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SiteProfileError(
      `профиль источника некорректен: ${parsed.error.issues
        .slice(0, 5)
        .map(i => `${i.path.join('.') || '—'}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
};

/** Сетевая политика: хост base_url, хосты адресов профиля и явно разрешённые, лимиты профиля. */
export const policyForProfile = (baseUrl: string, profile: ISiteProfile): ISourceNetworkPolicy => {
  const hosts = new Set<string>(profile.allowedHosts);
  for (const raw of [baseUrl, profile.rss, ...profile.startUrls, ...(profile.projectCards?.urls ?? [])]) {
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).hostname.toLowerCase().replace(/^www\./, ''));
    } catch {
      // некорректный адрес allowlist не расширяет
    }
  }
  return {
    allowedHosts: [...hosts],
    allowSubdomains: true,
    maxBytes: profile.limits.maxBytes,
    timeoutMs: profile.limits.timeoutMs,
    maxRedirects: DEFAULT_SOURCE_LIMITS.maxRedirects,
  };
};
