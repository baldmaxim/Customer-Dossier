// Контракт профиля источника (этап 16, source-profile@1): сведения для подключения и наблюдения, общие для сайтов и
// Telegram. Хранится в sources.config.meta рядом с настройками адаптера.
//
// Правила:
//  - всё неизвестное по умолчанию unknown / пусто, ничего не выводится из публичности адреса;
//  - основание допуска здесь — только ссылка на документ оператора; допуск ставится отдельно (sources.access_status,
//    ai_processing_status) и этим профилем не выдаётся — проверка профиля не открывает ни сбор, ни ИИ-обработку;
//  - allowedPathPrefixes сужает, а не расширяет: адреса вне префиксов не открываются, allowlist хостов — safeFetch.

import { z } from 'zod';

export const SOURCE_PROFILE_CONTRACT = 'source-profile@1';

const hostName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, 'имя хоста');

const pathPrefix = z
  .string()
  .trim()
  .max(120)
  .regex(/^\/[A-Za-z0-9._~\-/%]*$/, 'префикс пути начинается с / и без параметров');

const evidence = z
  .object({
    /** Ссылка на документ/переписку оператора, не текст разрешения. */
    reference: z.string().trim().min(3).max(500),
    checkedAt: z.string().trim().max(40),
    checkedBy: z.string().trim().min(1).max(120),
  })
  .strict();

export const sourceProfileMetaSchema = z
  .object({
    contract: z.literal(SOURCE_PROFILE_CONTRACT).default(SOURCE_PROFILE_CONTRACT),
    owner: z.string().trim().max(120).nullable().default(null),
    collectionMethod: z.enum(['rss', 'html_list', 'telegram_web_preview', 'telegram_bot', 'unknown']).default('unknown'),
    /** Для сведения и сверки с allowlist; сетевой доступ определяет safeFetch по base_url и хостам профиля. */
    allowedOrigins: z.array(hostName).max(10).default([]),
    allowedPathPrefixes: z.array(pathPrefix).max(20).default([]),
    /** Ожидаемая полнота текста по контракту источника; фактическая — по происхождению каждой редакции. */
    expectedCompleteness: z.enum(['full', 'excerpt', 'caption_only', 'unknown']).default('unknown'),
    dateNotes: z.string().trim().max(500).nullable().default(null),
    restrictions: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    frequency: z
      .object({
        pollIntervalSec: z.number().int().min(300).max(86_400 * 7).nullable().default(null),
        maxRequestsPerRun: z.number().int().min(1).max(200).nullable().default(null),
      })
      .strict()
      .default({}),
    permissionsEvidence: z
      .object({ collect: evidence.nullable().default(null), aiProcessing: evidence.nullable().default(null) })
      .strict()
      .default({}),
    /** draft — шаблон или неподтверждённые адреса; operator_checked — оператор сверил профиль с источником. */
    reviewStatus: z.enum(['draft', 'operator_checked']).default('draft'),
  })
  .strict();

export type ISourceProfileMeta = z.infer<typeof sourceProfileMetaSchema>;

/** Адрес внутри разрешённых префиксов пути. Пустой список — ограничения по пути нет. */
export const pathAllowed = (url: string, prefixes: readonly string[]): boolean => {
  if (prefixes.length === 0) return true;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  // Точки и кодированные разделители не выводят за префикс: сравнение по нормализованному URL-пути.
  return prefixes.some(p => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));
};
