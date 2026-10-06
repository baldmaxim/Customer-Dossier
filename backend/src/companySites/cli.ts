// Сайты компаний из консоли (этап 25A, ADR-018):
//
//   npm run site-search -- --status         включён ли поиск, расход за сутки, очередь и решения
//   npm run site-search -- --probe <ИНН>    один живой платный поиск по компании портала: запрос, страницы выдачи
//                                           (хосты), принятые и отброшенные адреса с причиной. Кандидатов и очереди
//                                           не пишет, но попытка занимает место в суточном лимите и идёт в журнал.
//                                           Первым делом — до SITE_SEARCH_ENABLED: приходят ли страницы выдачи
//                                           вместе со строгой JSON-схемой (иначе каждый поиск — no_citations).
//   npm run site-search -- --pass           один проход поиска по расписанию сейчас (только при включённом поиске)
//   npm run site-search -- --check          один проход проверки кандидатов (главная и до трёх страниц)
//
// На сервере: node dist/companySites/cli.js … в контейнере API. Ключ OpenRouter — из админки или LLM_API_KEY.

import { env } from '../config/env.js';
import { closeDb } from '../db/pool.js';
import { loadStoredLlmKey } from '../settings/llmKey.js';
import { runSiteCheckPass, runSiteSearchPass, searchCompanySite, siteSearchMode, type ISiteSearchRun } from './search.js';
import { companySitesTotals, loadSearchTargetByTaxId } from './store.js';

const argValue = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
};

const MODE_LINE: Record<ReturnType<typeof siteSearchMode>, string> = {
  off: 'выключен (SITE_SEARCH_ENABLED=false)',
  needs_openrouter: 'включён, но модель не OpenRouter — веб-поиска нет (LLM_PROVIDER=openrouter)',
  on: 'включён',
};

const printRun = (run: ISiteSearchRun): void => {
  console.log(`[site-search] ${run.name} (№${run.companyId}): ${run.outcome}`);
  console.log(`  запрос: ${run.query}`);
  console.log(`  страниц выдачи: ${run.citations}${run.citationHosts.length > 0 ? ` — ${run.citationHosts.join(', ')}` : ''}`);
  for (const site of run.accepted) console.log(`  принят: ${site.url} — ${site.reason}`);
  for (const site of run.rejected) console.log(`  отброшен: ${site.url} — ${site.why}`);
  if (run.noneReason) console.log(`  модель: ${run.noneReason}`);
  if (run.error) console.log(`  ошибка: ${run.error}`);
};

const status = async (): Promise<void> => {
  console.log(`[site-search] поиск: ${MODE_LINE[siteSearchMode()]}; модель ${env.LMSTUDIO_MODEL}, страниц выдачи ${env.SITE_SEARCH_MAX_RESULTS}`);
  const t = await companySitesTotals();
  console.log(`[site-search] попыток за сутки: ${t.usedLastDay} из ${env.SITE_SEARCH_DAILY_LIMIT}`);
  console.log(`[site-search] компаний искали ${t.searched}; ждут решения ${t.withPending}; с подтверждённым сайтом ${t.confirmed}; не найдено ${t.notFound}`);
};

const loadKey = async (): Promise<void> => {
  if (env.LLM_PROVIDER !== 'openrouter') return;
  await loadStoredLlmKey().catch(err => console.warn(`[llm] ключ из админки не прочитан: ${err instanceof Error ? err.message : String(err)}`));
};

const main = async (): Promise<void> => {
  if (process.argv.includes('--status')) return status();
  const probe = argValue('--probe');
  if (probe !== null) {
    if (env.LLM_PROVIDER !== 'openrouter') throw new Error('веб-поиск есть только у OpenRouter: LLM_PROVIDER=openrouter');
    const target = await loadSearchTargetByTaxId(probe.trim());
    if (!target) throw new Error(`компании с реквизитом ${probe} в портале нет — заведите её по ИНН`);
    await loadKey();
    printRun(await searchCompanySite(target, 'probe', { persist: false }));
    return;
  }
  if (process.argv.includes('--pass')) {
    if (siteSearchMode() !== 'on') {
      console.log(`[site-search] поиск ${MODE_LINE[siteSearchMode()]} — проход не делается`);
      return;
    }
    await loadKey();
    const runs = await runSiteSearchPass(2);
    if (runs.length === 0) console.log('[site-search] очередь пуста');
    runs.forEach(printRun);
    return;
  }
  if (process.argv.includes('--check')) {
    const runs = await runSiteCheckPass(5);
    if (runs.length === 0) console.log('[site-check] кандидатов без проверки нет');
    for (const r of runs) {
      const c = r.check;
      console.log(`[site-check] ${r.host}: ${c.status}; ИНН ${c.innOnPage ?? '—'}, ОГРН ${c.ogrnOnPage ?? '—'}, название ${c.nameOnPage ?? '—'}, страниц ${c.pagesRead}${c.otherInns.length > 0 ? `, другие ИНН: ${c.otherInns.length}` : ''}${c.error ? `; ${c.error}` : ''}`);
    }
    return;
  }
  console.log('Использование: npm run site-search -- --status | --probe <ИНН> | --pass | --check');
};

main()
  .catch(err => {
    console.error(`[site-search] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => void closeDb());
