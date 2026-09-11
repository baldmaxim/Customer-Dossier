// Команды CLI для контроля качества: сравнение моделей, перепроверка полей,
// аудит канона, пересчёт нормализации, переразбор.
//
// Отдельно от cli-commands.ts: там очередь и осмотр документов, здесь то,
// что меняет или проверяет качество уже собранного канона.

import { env } from '../config/env.js';
import { compareModels, runShadowExtraction, type IDisagreement } from './compare.js';
import { renormalizeEntities, requeueForReextraction, runAudit } from './quality.js';
import { recheckProjectFields } from './recheck.js';

// --- Сравнение моделей ---------------------------------------------------

export const runShadowCommand = async (limit: number, sourceKey: string | null): Promise<void> => {
  console.log(
    `[shadow] модель ${env.LMSTUDIO_MODEL}, промпт ${env.PROMPT_VERSION}. ` +
      'Результаты пишутся только для сравнения — карточки не меняются.',
  );
  const result = await runShadowExtraction(limit, sourceKey);
  console.log(`[shadow] прогнано ${result.processed}, с ошибкой ${result.failed}`);
  console.log('[shadow] дальше: переключите LMSTUDIO_MODEL и повторите, затем --compare');
};

export const runCompareCommand = async (): Promise<void> => {
  const cmp = await compareModels();
  if (cmp.models.length === 0) {
    console.log(`[compare] разборов для промпта ${env.PROMPT_VERSION} нет`);
    return;
  }

  console.log(`[compare] промпт ${env.PROMPT_VERSION}\n`);
  console.log('  модель                          доков  успех  релев.  компаний  ср.время  макс.');
  for (const m of cmp.models) {
    console.log(
      `  ${m.model.padEnd(30)} ${String(m.documents).padStart(6)} ` +
        `${(m.okRate * 100).toFixed(0).padStart(5)}% ${(m.relevantRate * 100).toFixed(0).padStart(6)}% ` +
        `${m.avgCompanies.toFixed(1).padStart(9)} ${(m.avgLatencyMs / 1000).toFixed(1).padStart(8)}с ` +
        `${(m.maxLatencyMs / 1000).toFixed(0).padStart(5)}с`,
    );
  }

  const pair = cmp.pair;
  if (!pair) {
    console.log('\n[compare] модель одна — сравнивать не с чем.');
    console.log('[compare] прогоните вторую: смените LMSTUDIO_MODEL и запустите --shadow 30');
    return;
  }

  console.log(`\n[compare] ${pair.modelA}  против  ${pair.modelB}`);
  console.log(`   общих документов: ${pair.overlap}`);
  if (pair.overlap === 0) {
    console.log('   пересечения нет — прогоните --shadow по тем же документам');
    return;
  }
  console.log(`   согласие по релевантности: ${(pair.agreement * 100).toFixed(0)} %`);

  const printList = (title: string, list: IDisagreement[]): void => {
    if (list.length === 0) return;
    console.log(`\n   ${title}: ${list.length}`);
    for (const d of list.slice(0, 8)) {
      console.log(`     док ${d.documentId} · ${d.sourceTitle} · ${d.preview}…`);
    }
    if (list.length > 8) console.log(`     … и ещё ${list.length - 8}`);
  };

  printList(`релевантно только для ${pair.modelA}`, pair.onlyA);
  printList(`релевантно только для ${pair.modelB}`, pair.onlyB);

  console.log(
    '\n   Расхождения — это и есть ответ на вопрос «какая модель лучше».\n' +
      '   Откройте несколько через --doc <id> и решите, кто из моделей прав.',
  );
};

// --- Перепроверка полей --------------------------------------------------

export const runRecheckCommand = async (dryRun: boolean): Promise<void> => {
  const result = await recheckProjectFields(dryRun);
  console.log(`[recheck] проверено объектов: ${result.checked}`);
  if (result.details.length === 0) {
    console.log('[recheck] все города и адреса подтверждаются текстами');
    return;
  }
  console.log('[recheck] не подтверждается текстом:');
  for (const d of result.details) {
    console.log(`   объект ${d.id} «${d.name}» — ${d.field}: «${d.value}»`);
  }
  console.log(
    dryRun
      ? `\n[recheck] это предпросмотр. Без --dry поля будут очищены (объектов: ${result.cleared}).`
      : `\n[recheck] очищено объектов: ${result.cleared}`,
  );
};

// --- Качество канона -----------------------------------------------------

export const runAuditCommand = async (sampleSize: number): Promise<void> => {
  const audit = await runAudit(sampleSize);

  console.log('── 1. СКРЫТЫЕ ДУБЛИ ──────────────────────────────────────');
  console.log('   Похожие компании, по которым в очереди слияний нет решения.');
  if (audit.similarPairs.length === 0) {
    console.log('   не найдено');
  } else {
    for (const p of audit.similarPairs) {
      const key = p.sameKey ? '  ключ совпадает' : '';
      console.log(`   ${p.score.toFixed(2)}  «${p.a}»  ~  «${p.b}»${key}`);
    }
    console.log(
      '\n   Совпавший ключ при разных карточках почти всегда значит устаревшую\n' +
        '   нормализацию. Лечится --renormalize: пары уйдут в очередь слияний.',
    );
  }

  console.log('\n── 2. РОЛИ ───────────────────────────────────────────────');
  for (const r of audit.roleCounts) {
    console.log(`   ${String(r.mentions).padStart(4)} упом.  ${String(r.companies).padStart(3)} комп.  ${r.role}`);
  }
  const count = (role: string): number =>
    audit.roleCounts.find(r => r.role === role)?.mentions ?? 0;
  if (count('designer') > count('general_contractor') + count('contractor')) {
    console.log(
      '\n   ТРЕВОГА: проектировщиков больше, чем генподрядчиков и подрядчиков вместе.\n' +
        '   В стройновостях так не бывает — скорее всего, аналитиков и консультантов\n' +
        '   из пресс-релизов записывают проектировщиками.',
    );
  }

  console.log('\n── 3. ОБЪЕКТЫ, ЗАПИСАННЫЕ КОМПАНИЯМИ ─────────────────────');
  if (audit.companiesNamedLikeProjects.length === 0) {
    console.log('   не найдено');
  } else {
    for (const c of audit.companiesNamedLikeProjects) {
      console.log(`   компания «${c.company}» = объект «${c.project}»`);
    }
  }

  console.log(`\n── 4. ВЫБОРКА ДЛЯ ПРОВЕРКИ ГЛАЗАМИ (${audit.roleSample.length}) ─────────────`);
  for (const s of audit.roleSample) {
    const quote = s.quote.replace(/\s+/g, ' ').slice(0, 150);
    console.log(`\n   ${s.company}  →  ${s.role}   (док ${s.documentId})`);
    console.log(`   «${quote}${s.quote.length > 150 ? '…' : ''}»`);
  }
  console.log(
    '\n   По каждой строке один вопрос: эта компания действительно в такой роли\n' +
      '   НА ОБЪЕКТЕ — или просто упомянута в тексте?',
  );
};

export const runRenormalizeCommand = async (dryRun: boolean): Promise<void> => {
  const r = await renormalizeEntities(dryRun);
  const verb = dryRun ? 'будет пересчитано' : 'пересчитано';
  console.log(`[renormalize] компаний ${verb}: ${r.companiesChanged}`);
  console.log(`[renormalize] объектов ${verb}: ${r.projectsChanged}`);
  console.log(`[renormalize] алиасов ${verb}: ${r.aliasesChanged}, склеено дублей: ${r.aliasesMerged}`);

  if (r.duplicatePairs.length === 0) {
    console.log('[renormalize] совпавших ключей нет');
  } else {
    console.log(`[renormalize] после пересчёта совпали ключи (${r.duplicatePairs.length}):`);
    for (const p of r.duplicatePairs) console.log(`   «${p.a}»  =  «${p.b}»`);
    console.log(
      dryRun
        ? '\n[renormalize] предпросмотр: ничего не записано. Без --dry пары уйдут в очередь слияний.'
        : '\n[renormalize] пары отправлены в очередь слияний — решение за вами: --merges',
    );
  }
};

export const runReextractCommand = async (sourceKey: string | null): Promise<void> => {
  const affected = await requeueForReextraction(sourceKey);
  console.log(
    `[reextract] в очередь на переразбор: ${affected} ` +
      `(модель ${env.LMSTUDIO_MODEL}, промпт ${env.PROMPT_VERSION})`,
  );
  if (affected === 0) {
    console.log(
      '[reextract] всё уже разобрано этой моделью при этом промпте.\n' +
        '[reextract] Если правили промпт — поднимите PROMPT_VERSION в .env.',
    );
    return;
  }
  console.log('[reextract] прежние упоминания и роли каждого документа будут заменены новыми.');
  console.log('[reextract] запустите: npm run pipeline:once -- --loop');
  if (sourceKey) {
    console.log(
      '[reextract] Внимание: переразбор одного источника. Роль на объекте, созданная\n' +
        '[reextract] его документом, пропадёт, даже если её подтверждал другой источник.\n' +
        '[reextract] После смены промпта надёжнее переразобрать всё, без --source.',
    );
  }
};
