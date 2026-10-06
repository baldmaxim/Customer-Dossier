// Разбор разногласий моделью из консоли (02.10.2026):
//
//   npm run review:model -- [--limit N] [--apply]          # в образе: node dist/resolve/modelReviewCli.js
//   npm run review:model -- --sound-pairs [--apply]        # пары по звучанию названия (soundPairs.ts)
//
// Без --apply — только вердикты: подсказки к совпадениям ДОМ.РФ, план решений по ним и вердикты по парам
// «возможный дубль» пишутся рядом с записями, решения не применяются. Так владелец сначала смотрит, что
// решит модель. С --apply — применяет: «Это он / Не он», слияние (при MERGE_APPLY_ENABLED) и отклонение пар.
// Печатает отчёт: что решено, кем (правило или модель) и почему.
//
// --sound-pairs — модель не вызывается: план пар «одно название в разной записи» (Сминекс — Sminex), с --apply
// новые пары ставятся в очередь (до --limit), вердикт по ним выносит следующий прогон или тик.

import { env } from '../config/env.js';
import { closeDb } from '../db/pool.js';
import { loadStoredLlmKey } from '../settings/llmKey.js';
import { syncDomRfGroupRelations } from '../registry/groupSync.js';
import { withdrawModelExtractionOnRegistry } from '../registry/modelArtifacts.js';
import { applyDomRfModelDecisions } from '../ingest/registry/domrfModelDecisions.js';
import { runDomRfHintPass } from '../ingest/registry/domrfHints.js';
import { applyJudgedPairs, modelReviewCounts, runModelReviewPass, type IPairJudgement } from './modelReview.js';
import { enqueueSoundPairs } from './soundPairs.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number.parseInt(args[limitArg + 1] ?? '', 10) : 50;
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
  console.error('--limit ожидает число от 1 до 1000');
  process.exit(2);
}

const ACTION_WORDS: Record<string, string> = {
  judged: 'только вердикт',
  merged: 'СЛИТО',
  rejected: 'пара отклонена',
  blocked: 'не применено',
};

if (args.includes('--sound-pairs')) {
  try {
    const result = await enqueueSoundPairs({ limit, dryRun: !apply, force: true });
    console.log(`Пары по звучанию названия — ${apply ? 'С ЗАПИСЬЮ в очередь' : 'план, без записи'}\n`);
    console.log(`Найдено пар: ${result.pairs.length}, новых для очереди: ${result.fresh.length}`);
    for (const p of result.fresh) {
      console.log(`  «${p.sourceName}» (№ ${p.sourceId}) ↔ «${p.targetName}» (№ ${p.targetId}) — ключ ${p.sound}`);
    }
    for (const c of result.tooCommon) console.log(`  пропущен общий ключ ${c.sound}: компаний ${c.companies}`);
    if (apply) console.log(`\nПоставлено в очередь: ${result.inserted}${result.fresh.length > limit ? ` (остальные — следующим запуском, --limit ${limit})` : ''}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
  process.exit(process.exitCode ?? 0);
}

try {
  // Ключ OpenRouter из админки живёт в базе: без этого команда видела бы только LLM_API_KEY из .env.
  if (env.LLM_PROVIDER === 'openrouter') {
    await loadStoredLlmKey().catch(err => console.warn(`[llm] ключ из админки не прочитан: ${err instanceof Error ? err.message : String(err)}`));
  }
  console.log(`Разбор разногласий моделью — ${apply ? 'С ПРИМЕНЕНИЕМ' : 'без применения (посмотреть)'}, до ${limit} записей за шаг\n`);

  const hints = await runDomRfHintPass(limit);
  console.log(`ДОМ.РФ: подсказок модели к совпадениям — ${hints.filter(h => h.outcome === 'saved').length}`);
  for (const h of hints.filter(h => h.outcome !== 'saved')) console.log(`  совпадение ${h.linkId}: ${h.outcome} — ${h.reason}`);

  const decisions = await applyDomRfModelDecisions(apply);
  console.log(`ДОМ.РФ: решений по совпадениям — ${decisions.length}${apply ? `, применено ${decisions.filter(d => d.applied).length}` : ''}`);
  for (const d of decisions) {
    console.log(`  ${d.companyName} (№ ${d.companyId}): ${d.action === 'confirm' ? 'ЭТО ОН' : 'не он'} — ${d.record}; ${d.reason}${apply && !d.applied ? ' [не применено]' : ''}`);
  }
  if (apply) {
    const extraction = await withdrawModelExtractionOnRegistry();
    console.log(`Реестр: снято доказательств разбора моделью по снимкам — ${extraction.evidence}, запусков — ${extraction.runs}`);
    const sync = await syncDomRfGroupRelations();
    console.log(`ДОМ.РФ: связи «входит в группу» — записано ${sync.linked}, снято ${sync.withdrawn}`);
  }

  // С --apply сначала применяются вердикты, вынесенные прогоном «посмотреть», затем оцениваются новые пары.
  const stored: IPairJudgement[] = apply ? await applyJudgedPairs(limit) : [];
  const pairs = [...stored, ...(await runModelReviewPass({ limit, apply }))];
  console.log(`\nДубли: пар разобрано — ${pairs.length}${apply ? ` (по прежним вердиктам — ${stored.length})` : ''}`);
  for (const p of pairs) {
    const kind = p.kind === 'company' ? 'компании' : 'объекты';
    console.log(
      `  [${kind}] «${p.sourceName}» (№ ${p.sourceId}) ↔ «${p.targetName}» (№ ${p.targetId}): ${p.verdict}` +
        ` (${p.by === 'rule' ? 'правило' : 'модель'}) — ${p.reason}; ${ACTION_WORDS[p.action] ?? p.action}${p.note ? ` (${p.note})` : ''}`,
    );
  }
  if (apply) {
    const by = (action: string): number => pairs.filter(p => p.action === action).length;
    console.log(`Итог: слито ${by('merged')}, отклонено ${by('rejected')}, не применено ${by('blocked')}, только вердикт ${by('judged')}`);
  }
  const counts = await modelReviewCounts();
  console.log(`\nОсталось пар без вердикта нынешней модели: ${counts.waiting}; с вердиктом и ждут решения: ${counts.judged}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await closeDb();
}
