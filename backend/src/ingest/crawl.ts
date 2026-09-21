// Выбор адаптера по профилю источника (этап 20A).
//
// Реестр — это режим профиля, а не отдельный вид источника: sources.kind остаётся
// website, поэтому допуск, здоровье, журнал запусков и кнопка пробы в админке
// работают для него без изменений.

import { crawlRegistry } from './registry/crawler.js';
import { isRegistryConfig, parseRegistryProfile } from './registry/profile.js';
import { crawlSite, type ICrawlOptions, type ICrawlReport } from './sites/crawler.js';
import { parseSiteProfile } from './sites/profile.js';
import type { ISource } from './sources.js';

export const crawlSource = async (source: ISource, options: ICrawlOptions = {}): Promise<ICrawlReport> =>
  isRegistryConfig(source.config) ? crawlRegistry(source, options) : crawlSite(source, options);

export interface ISourceProfileSummary {
  mode: string;
  maxItemsPerRun: number;
  /** Короткое описание объёма прохода для оператора. */
  detail: string;
}

/**
 * Проверка профиля перед записью — общая для CLI и админки. Бросает ошибку своего
 * режима; допуска не выдаёт и запросов не делает.
 */
export const parseSourceProfile = (config: Record<string, unknown>): ISourceProfileSummary => {
  if (isRegistryConfig(config)) {
    const profile = parseRegistryProfile(config);
    return {
      mode: profile.mode,
      maxItemsPerRun: profile.limits.maxItemsPerRun,
      detail: `объектов ${profile.objectIds.length}, застройщиков ${profile.developerIds.length}, обход каталога ${profile.list ? 'есть' : 'нет'}`,
    };
  }
  const profile = parseSiteProfile(config);
  return { mode: profile.mode, maxItemsPerRun: profile.limits.maxItemsPerRun, detail: `страниц до ${profile.pagination?.maxPages ?? 1}` };
};
