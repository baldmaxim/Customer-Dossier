// Разбор разногласий моделью из консоли (02.10.2026):
//
//   npm run review:model -- [--limit N] [--apply]          # в образе: node dist/resolve/modelReviewCli.js
//
// Без --apply — только вердикты: подсказки к совпадениям ДОМ.РФ, план решений по ним и вердикты по парам
// «возможный дубль» пишутся рядом с записями, решения не применяются. Так владелец сначала смотрит, что
// решит модель. С --apply — применяет: «Это он / Не он», слияние (при MERGE_APPLY_ENABLED) и отклонение пар.
// Печатает отчёт: что решено, кем (правило или модель) и почему.

import { env } from '../config/env.js';
import { closeDb } from '../db/pool.js';
import { loadStoredLlmKey } from '../settings/llmKey.js';
import { syncDomRfGroupRelations } from '../registry/groupSync.js';
import { applyDomRfModelDecisions } from '../ingest/registry/domrfModelDecisions.js';
import { runDomRfHintPass } from '../ingest/registry/domrfHints.js';
import { modelReviewCounts, runModelReviewPass } from './modelReview.js';

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
    const sync = await syncDomRfGroupRelations();
    console.log(`ДОМ.РФ: связи «входит в группу» — записано ${sync.linked}, снято ${sync.withdrawn}`);
  }

  const pairs = await runModelReviewPass({ limit, apply });
  console.log(`\nДубли: пар разобрано — ${pairs.length}`);
  for (const p of pairs) {
    const kind = p.kind === 'company' ? 'компании' : 'объекты';
    console.log(
      `  [${kind}] «${p.sourceName}» (№ ${p.sourceId}) ↔ «${p.targetName}» (№ ${p.targetId}): ${p.verdict}` +
        ` (${p.by === 'rule' ? 'правило' : 'модель'}) — ${p.reason}; ${ACTION_WORDS[p.action] ?? p.action}${p.note ? ` (${p.note})` : ''}`,
    );
  }
  const counts = await modelReviewCounts();
  console.log(`\nОсталось пар без вердикта нынешней модели: ${counts.waiting}; с вердиктом и ждут решения: ${counts.judged}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await closeDb();
}
