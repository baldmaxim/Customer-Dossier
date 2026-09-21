// Команда `npm run pipeline:once -- --headlines [--limit N]`.
//
// Нужна для уже собранных текстов: фоновый проход берёт свежие, а разом назвать
// накопленное — разовая работа оператора. Допуск источника проверяется на каждой
// редакции, как и в фоне.

import { env } from '../config/env.js';
import { runHeadlinePass } from './service.js';

export const headlinesCommand = async (limit: number): Promise<void> => {
  if (!env.HEADLINE_ENABLED) {
    console.log('[headline] выключено (HEADLINE_ENABLED=false) — тем не будет');
    return;
  }
  const results = await runHeadlinePass(limit);
  if (results.length === 0) {
    console.log('[headline] редакций без темы нет: все допущенные публикации уже названы');
    return;
  }
  const by = (outcome: string): number => results.filter(r => r.outcome === outcome).length;
  for (const r of results) {
    if (r.outcome === 'saved') console.log(`  редакция ${r.revisionId}: ${r.topic}`);
    else if (r.outcome === 'model_error') console.warn(`  редакция ${r.revisionId}: модель не ответила — ${r.reason}`);
    else if (r.outcome === 'refused_policy') console.warn(`  редакция ${r.revisionId}: нет ИИ-допуска — ${r.reason}`);
  }
  console.log(
    `[headline] тем составлено ${by('saved')}, уже было ${by('exists')}, ` +
      `без допуска ${by('refused_policy')}, отказов модели ${by('model_error')}`,
  );
};
