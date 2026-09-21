// Профиль источника-реестра (этап 20A): адреса эндпоинтов и карта полей — данные, не код.
//
// Почему отдельный режим, а не селекторы: каталог новостроек наш.дом.рф отдаёт оболочку
// приложения, а сами данные приходят отдельным JSON. Разбирать HTML там нечего.
//
// В профиле нет кода: путь к значению — точечный путь по разобранному JSON
// (developer.devInn), шаблон адреса — строка с подстановками {id}/{offset}/{limit}.
// Неизвестные ключи отвергаются, как и в профиле сайта.

import { z } from 'zod';

import { DEFAULT_SOURCE_LIMITS, type ISourceNetworkPolicy } from '../../net/safeFetch.js';
import { sourceProfileMetaSchema } from '../profileMeta.js';

/** Версия правил разбора реестра: меняется при правке карты полей и рендера. */
export const REGISTRY_PARSER_VERSION = 'registry@1';

/** Точечный путь по JSON: ключи и индексы массивов. Ни кода, ни регулярных выражений. */
const jsonPath = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/, 'путь вида developer.devInn');

const idString = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'идентификатор записи реестра');

const httpUrlTemplate = (placeholder: string) =>
  z
    .string()
    .trim()
    .max(500)
    .refine(v => /^https?:\/\//i.test(v), 'только http/https')
    .refine(v => v.includes(placeholder), 'адрес обязан содержать подстановку ' + placeholder)
    .refine(v => {
      try {
        // Подстановку заменяем на заведомо безопасное значение: проверяется именно адрес.
        new URL(v.replace(/\{[a-z]+\}/g, '1'));
        return true;
      } catch {
        return false;
      }
    }, 'некорректный адрес');

const fieldSpec = z
  .object({
    /** Подпись поля в тексте снимка. Порядок полей в профиле — порядок строк. */
    label: z.string().trim().min(1).max(80),
    path: jsonPath,
    /** Как привести значение к строке. Пересчёта величин нет: money — только форматирование. */
    format: z.enum(['text', 'number', 'date', 'money', 'percent', 'bool']).default('text'),
    unit: z.string().trim().max(20).optional(),
  })
  .strict();

const objectIdentity = z
  .object({
    idPath: jsonPath,
    namePath: jsonPath,
    /** Что за объекты в этом реестре. Не задано — резолвер поставит вид по умолчанию. */
    projectKind: z.enum(['residential', 'office', 'industrial', 'infrastructure', 'social', 'other']).optional(),
    cityPath: jsonPath.optional(),
    addressPath: jsonPath.optional(),
    /** Дата сведений по самому реестру. Нет — строки о дате не будет; время сбора не подставляем. */
    asOfPath: jsonPath.optional(),
    developerNamePath: jsonPath.optional(),
    developerFormPath: jsonPath.optional(),
    developerInnPath: jsonPath.optional(),
    developerOgrnPath: jsonPath.optional(),
    groupNamePath: jsonPath.optional(),
  })
  .strict();

const developerIdentity = z
  .object({
    idPath: jsonPath,
    namePath: jsonPath,
    formPath: jsonPath.optional(),
    innPath: jsonPath.optional(),
    ogrnPath: jsonPath.optional(),
    cityPath: jsonPath.optional(),
    groupNamePath: jsonPath.optional(),
    asOfPath: jsonPath.optional(),
  })
  .strict();

export const registryProfileSchema = z
  .object({
    version: z.literal(1).default(1),
    mode: z.literal('registry_api'),
    /** Хосты сверх хоста base_url и эндпоинтов. */
    allowedHosts: z.array(z.string().trim().toLowerCase().max(253)).max(10).default([]),
    endpoints: z
      .object({
        object: httpUrlTemplate('{id}'),
        developer: httpUrlTemplate('{id}').optional(),
        /** Поиск по застройщику или региону: параметры запроса задаёт сам адрес. */
        list: httpUrlTemplate('{offset}').optional(),
      })
      .strict(),
    /** Явный перечень записей. Пустые списки и отсутствие list — профилю нечего делать. */
    objectIds: z.array(idString).max(200).default([]),
    developerIds: z.array(idString).max(200).default([]),
    list: z
      .object({
        itemsPath: jsonPath,
        /** Путь к идентификатору внутри элемента списка. */
        idPath: jsonPath,
        limit: z.number().int().min(1).max(100).default(20),
        maxPages: z.number().int().min(1).max(20).default(1),
      })
      .strict()
      .optional(),
    /** Где в ответе лежит сама запись, если она завёрнута (например, data). */
    responsePath: z.object({ object: jsonPath.optional(), developer: jsonPath.optional() }).strict().default({}),
    fields: z
      .object({ object: z.array(fieldSpec).max(60).default([]), developer: z.array(fieldSpec).max(60).default([]) })
      .strict()
      .default({}),
    identity: z.object({ object: objectIdentity, developer: developerIdentity.optional() }).strict(),
    limits: z
      .object({
        maxItemsPerRun: z.number().int().min(1).max(200).default(20),
        maxBytes: z.number().int().min(10_000).max(DEFAULT_SOURCE_LIMITS.maxBytes).default(DEFAULT_SOURCE_LIMITS.maxBytes),
        timeoutMs: z.number().int().min(1000).max(60_000).default(DEFAULT_SOURCE_LIMITS.timeoutMs),
        /** Троттлинг: по умолчанию один запрос в 4 секунды. */
        delayMs: z.number().int().min(0).max(60_000).default(4000),
      })
      .strict()
      .default({}),
    expectations: z.object({ minItemsOnList: z.number().int().min(0).max(100).default(1) }).strict().default({}),
    meta: sourceProfileMetaSchema.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.objectIds.length === 0 && p.developerIds.length === 0 && !p.list) {
      ctx.addIssue({ code: 'custom', message: 'нечего собирать: нужен objectIds, developerIds или list' });
    }
    if (p.list && !p.endpoints.list) {
      ctx.addIssue({ code: 'custom', message: 'list требует endpoints.list' });
    }
    if (p.developerIds.length > 0 && !p.endpoints.developer) {
      ctx.addIssue({ code: 'custom', message: 'developerIds требует endpoints.developer' });
    }
    if (p.endpoints.developer && !p.identity.developer) {
      ctx.addIssue({ code: 'custom', message: 'endpoints.developer требует identity.developer' });
    }
  });

export type IRegistryProfile = z.infer<typeof registryProfileSchema>;
export type IRegistryFieldSpec = z.infer<typeof fieldSpec>;

export class RegistryProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryProfileError';
  }
}

/** Профиль реестра — это режим, а не вид источника: sources.kind остаётся website. */
export const isRegistryConfig = (config: Record<string, unknown>): boolean => config.mode === 'registry_api';

export const parseRegistryProfile = (config: Record<string, unknown>): IRegistryProfile => {
  const parsed = registryProfileSchema.safeParse(config);
  if (!parsed.success) {
    throw new RegistryProfileError(
      `профиль реестра некорректен: ${parsed.error.issues
        .slice(0, 5)
        .map(i => `${i.path.join('.') || '—'}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
};

/** Адрес записи по шаблону профиля. Значение подставляется закодированным. */
export const buildUrl = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{([a-z]+)\}/g, (whole, key: string) => (key in values ? encodeURIComponent(String(values[key])) : whole));

/** Сетевая политика: хост base_url, хосты эндпоинтов и явно разрешённые, лимиты профиля. */
export const policyForRegistryProfile = (baseUrl: string, profile: IRegistryProfile): ISourceNetworkPolicy => {
  const hosts = new Set<string>(profile.allowedHosts);
  const candidates = [baseUrl, profile.endpoints.object, profile.endpoints.developer, profile.endpoints.list];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      hosts.add(new URL(raw.replace(/\{[a-z]+\}/g, '1')).hostname.toLowerCase().replace(/^www\./, ''));
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
