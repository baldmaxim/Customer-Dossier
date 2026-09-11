// CLI пайплайна извлечения. Здесь только разбор аргументов — реализация команд
// в cli-commands.ts (очередь и осмотр) и cli-quality.ts (качество канона).
//
// Разбор очереди
//   --check                    LM Studio поднят, модель загружена?
//   (без флагов)               обработать одну пачку
//   --loop                     крутить, пока очередь не опустеет
//   --stats                    состояние очереди и доля ошибок
//
// Осмотр и починка
//   --errors                   последние отказы с текстом ошибки
//   --retry                    вернуть провалившиеся и застрявшие
//   --skipped [--source <key>] нерелевантные и их доля по источникам
//   --retry-skipped [--all]    вернуть нерелевантные, не оценённые текущей моделью
//   --doc <id>                 документ целиком: текст, разбор, что легло в канон
//
// Слияния
//   --merges                   очередь на ручное слияние
//   --merge <id> / --reject <id>
//
// Качество канона
//   --audit [--sample N]       скрытые дубли, распределение ролей, объекты-компании
//   --renormalize [--dry]      пересчитать ключи поиска, совпавшие пары — в очередь
//   --reextract [--source key] переразобрать всё, что не разобрано текущим промптом
//   --recheck [--dry]          снять города и адреса, не подтверждённые текстом
//
// Выбор модели
//   --shadow N [--source key]  прогнать текущую модель, не трогая карточки
//   --compare                  сравнить модели на одних документах

import { closeDb } from '../db/pool.js';
import { checkLlmConnection } from '../llm/client.js';
import { env } from '../config/env.js';
import { applyMerge, rejectMerge } from '../resolve/merge.js';
import { runPipelinePass } from './worker.js';
import {
  printPass,
  retryFailed,
  retrySkipped,
  showDocument,
  showErrors,
  showMerges,
  showSkipped,
  showStats,
} from './cli-commands.js';
import {
  runAuditCommand,
  runCompareCommand,
  runRecheckCommand,
  runReextractCommand,
  runRenormalizeCommand,
  runShadowCommand,
} from './cli-quality.js';

const argValue = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
};

const has = (flag: string): boolean => process.argv.includes(flag);

const checkModel = async (): Promise<void> => {
  const llm = await checkLlmConnection();
  if (!llm.ok) {
    console.error(`[llm] недоступен по ${env.LMSTUDIO_BASE_URL}: ${llm.error}`);
    console.error('[llm] запустите LM Studio и включите локальный сервер.');
    process.exitCode = 1;
    return;
  }
  console.log(`[llm] доступен, моделей загружено: ${llm.models.length}`);
  for (const m of llm.models) {
    console.log(`  ${m}${m === env.LMSTUDIO_MODEL ? '  <-- LMSTUDIO_MODEL' : ''}`);
  }
  if (!llm.models.includes(env.LMSTUDIO_MODEL)) {
    console.warn(`[llm] модель ${env.LMSTUDIO_MODEL} не найдена среди загруженных`);
    process.exitCode = 1;
  }
};

const main = async (): Promise<void> => {
  // Порядок проверок значим: --retry-skipped должен разбираться раньше --retry
  // по смыслу, хотя includes и сравнивает аргументы целиком.
  if (has('--check')) return checkModel();
  if (has('--stats')) return showStats();
  if (has('--errors')) return showErrors();
  if (has('--merges')) return showMerges();
  if (has('--retry-skipped')) return retrySkipped(has('--all'));
  if (has('--retry')) return retryFailed();
  if (has('--skipped')) return showSkipped(10, argValue('--source'));

  if (has('--audit')) return runAuditCommand(Number(argValue('--sample') ?? 20));
  if (has('--renormalize')) return runRenormalizeCommand(has('--dry'));
  if (has('--reextract')) return runReextractCommand(argValue('--source'));
  if (has('--recheck')) return runRecheckCommand(has('--dry'));
  if (has('--compare')) return runCompareCommand();

  const shadowLimit = argValue('--shadow');
  if (shadowLimit) return runShadowCommand(Number(shadowLimit), argValue('--source'));

  const docId = argValue('--doc');
  if (docId) return showDocument(Number(docId));

  const mergeId = argValue('--merge');
  if (mergeId) {
    const result = await applyMerge({ queueId: Number(mergeId), decidedBy: 'cli' });
    console.log(
      `[merge] ${result.entityKind} ${result.sourceId} -> ${result.targetId}: ` +
        `перенесено упоминаний ${result.movedMentions}, ролей ${result.movedParticipants}`,
    );
    return;
  }

  const rejectId = argValue('--reject');
  if (rejectId) {
    await rejectMerge(Number(rejectId), 'cli');
    console.log(`[merge] пара #${rejectId} отклонена`);
    return;
  }

  if (has('--loop')) {
    for (;;) {
      const results = await runPipelinePass();
      if (results.length === 0) break;
      printPass(results);
    }
    console.log('[pipeline] очередь разобрана');
    return;
  }

  printPass(await runPipelinePass());
};

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    console.error('[pipeline] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
