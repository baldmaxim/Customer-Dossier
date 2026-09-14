// CLI пайплайна извлечения. Здесь только разбор аргументов — реализация команд
// в cli-commands.ts (очередь и осмотр) и cli-quality.ts (качество канона).
//
// [Б] — заблокировано (pipeline/guard.ts): legacy-запись канона с удалением
// вклада документа и слияние (этап 04). Команда завершится с объяснением.
//
// Новый конвейер (этап 03B): запуск → чанки → набор кандидатов → публикация
//   --check                    LM Studio поднят, модель загружена?
//   (без флагов)               выполнить поставленные запуски (одна пачка)
//   --loop                     выполнять, пока очередь запусков не опустеет
//   --runs [--limit N]         последние запуски, покрытие, наборы
//   --reextract --limit N [--source key] [--doc id]
//                              поставить запуски по последним редакциям (карточки не меняются)
//   --retry [--limit N]        новые запуски вместо failed/partial (прежние не меняются)
//   --preview <набор>          что изменит публикация набора
//   --publish <набор> [--allow-stale]  опубликовать набор (одна транзакция)
//   --stats                    состояние legacy-очереди и доля ошибок
//
// Осмотр и починка
//   --errors                   последние отказы с текстом ошибки
//   --skipped [--source <key>] нерелевантные и их доля по источникам
//   --retry-skipped [--all] [Б] вернуть нерелевантные в очередь
//   --doc <id>                 документ целиком: текст, разбор, что легло в канон
//
// Слияния
//   --merges                   очередь на ручное слияние
//   --merge <id>               предпросмотр пары: реквизиты, конфликты, переносимые зависимости
//   --merge <id> --yes         применить (MERGE_APPLY_ENABLED=true; версии — из предпросмотра)
//   --merge-history            журнал слияний
//   --merge-undo <слияние>     отменить, если после слияния ничего не изменилось; иначе — план
//   --reject <id>              отклонить пару
//
// Качество канона
//   --audit [--sample N]       скрытые дубли, распределение ролей, объекты-компании
//   --renormalize --dry        предпросмотр пересчёта ключей (без --dry — [Б])
//   --recheck --dry            предпросмотр снятия городов и адресов (без --dry — [Б])
//
// Выбор модели (пишут только в extractions, нужен допуск источника к ИИ-обработке)
//   --shadow N [--source key]  прогнать текущую модель, не трогая карточки
//   --compare                  сравнить модели на одних документах

import { closeDb } from '../db/pool.js';
import { checkLlmConnection } from '../llm/client.js';
import { env } from '../config/env.js';
import { rejectMerge } from '../resolve/merge.js';
import { mergeCommand, sendMergeCliError, showMergeHistory, undoMergeCommand } from './cli-merge.js';
import { CanonWriteBlockedError } from './guard.js';
import {
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
  runRenormalizeCommand,
  runShadowCommand,
} from './cli-quality.js';
import {
  previewCommand,
  processRunsCommand,
  publishCommand,
  reextractCommand,
  retryRunsCommand,
  showRuns,
} from '../reprocess/cli-commands.js';
import { NotPublishableError, PublicationConflictError } from '../reprocess/publish.js';

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
  if (has('--retry')) return retryRunsCommand(Number(argValue('--limit') ?? 20));
  if (has('--runs')) return showRuns(Number(argValue('--limit') ?? 20));
  const previewId = argValue('--preview');
  if (previewId) return previewCommand(Number(previewId));
  const publishId = argValue('--publish');
  if (publishId) return publishCommand(Number(publishId), has('--allow-stale'));
  if (has('--skipped')) return showSkipped(10, argValue('--source'));

  if (has('--audit')) return runAuditCommand(Number(argValue('--sample') ?? 20));
  if (has('--renormalize')) return runRenormalizeCommand(has('--dry'));
  if (has('--reextract')) {
    const limit = argValue('--limit');
    const doc = argValue('--doc');
    return reextractCommand({
      limit: limit === null ? null : Number(limit),
      sourceKey: argValue('--source'),
      documentId: doc === null ? null : Number(doc),
    });
  }
  if (has('--recheck')) return runRecheckCommand(has('--dry'));
  if (has('--compare')) return runCompareCommand();

  const shadowLimit = argValue('--shadow');
  if (shadowLimit) return runShadowCommand(Number(shadowLimit), argValue('--source'));

  const docId = argValue('--doc');
  if (docId) return showDocument(Number(docId));

  if (has('--merge-history')) return showMergeHistory();
  const undoId = argValue('--merge-undo');
  if (undoId) return undoMergeCommand(Number(undoId));
  const mergeId = argValue('--merge');
  if (mergeId) return mergeCommand(Number(mergeId), has('--yes'));

  const rejectId = argValue('--reject');
  if (rejectId) {
    await rejectMerge(Number(rejectId), 'cli');
    console.log(`[merge] пара #${rejectId} отклонена`);
    return;
  }

  return processRunsCommand(has('--loop'));
};

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    if (sendMergeCliError(err)) {
      // сообщение уже напечатано
    } else if (err instanceof PublicationConflictError || err instanceof NotPublishableError) {
      console.error(`[publish] ${err.message}`);
    } else if (err instanceof CanonWriteBlockedError) {
      console.error(`[pipeline] команда заблокирована: ${err.reason}`);
    } else {
      console.error('[pipeline] прервано:', err instanceof Error ? err.message : String(err));
    }
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
