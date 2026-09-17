// CLI безопасного слияния (этап 04). Без --yes — только предпросмотр.

import {
  EntityVersionConflictError,
  MergeBlockedError,
  MergeIdempotencyMismatchError,
  MergeNotFoundError,
  MergePreviewStaleError,
  UnsafeUndoError,
  type IMergePreview,
} from '../resolve/entityMerge.js';
import { applyQueuedMerge, listMergeHistory, previewQueuedMerge, undoMerge } from '../resolve/merge.js';

const printPreview = (queueId: number, p: IMergePreview & { queueStatus: string }): void => {
  console.log(`[merge] пара #${queueId} (${p.kind}, очередь: ${p.queueStatus})`);
  for (const [label, e] of [['источник', p.source], ['цель', p.target]] as const) {
    const ids = e.identifiers.map(i => `${i.type}=${i.value}`).join(', ') || 'реквизитов нет';
    const extra = p.kind === 'company' ? `${e.entityType ?? '—'}, ${e.legalForm ?? 'форма ?'}` : `${e.projectLevel ?? '—'}`;
    console.log(`  ${label}: #${e.id} «${e.name}» v${e.version} (${extra}; город ${e.city ?? 'неизвестен'}; ${ids})`);
  }
  console.log(`  переносится: ${Object.entries(p.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const c of p.conflicts) console.log(`  БЛОК [${c.code}]: ${c.message}`);
  for (const w of p.warnings) console.log(`  внимание: ${w}`);
  console.log(
    p.canApply
      ? `\n  Применить: --merge ${queueId} --yes (нужен MERGE_APPLY_ENABLED=true)`
      : '\n  Слияние невозможно, пока есть блокирующие конфликты.',
  );
};

export const mergeCommand = async (queueId: number, yes: boolean): Promise<void> => {
  const preview = await previewQueuedMerge(queueId);
  printPreview(queueId, preview);
  if (!yes || !preview.canApply) {
    if (!preview.canApply) process.exitCode = 1;
    return;
  }
  // Ключ зависит от пары и версий предпросмотра: повтор той же команды не сливает дважды.
  const result = await applyQueuedMerge({
    queueId,
    actor: 'cli',
    expectedSourceVersion: preview.source.version,
    expectedTargetVersion: preview.target.version,
    // Между выводом предпросмотра и применением ничего не должно измениться (merge-preview@1).
    expectedPreviewToken: preview.previewToken,
    idempotencyKey: `cli-merge-q${queueId}-s${preview.source.version}-t${preview.target.version}`,
  });
  console.log(
    `[merge] ${result.replayed ? 'уже применено ранее' : 'применено'}: слияние #${result.mergeId}, версия цели ${result.targetVersion}` +
      `; ${Object.entries(result.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );
};

export const showMergeHistory = async (): Promise<void> => {
  const items = await listMergeHistory();
  if (items.length === 0) {
    console.log('[merge] слияний не было');
    return;
  }
  for (const m of items) {
    console.log(
      `#${m.id} ${m.entityKind} «${m.sourceName ?? m.sourceId}» → «${m.targetName ?? m.targetId}» ${m.status} (${m.actor})` +
        (m.undoneAt ? `, отменено` : ''),
    );
  }
};

export const undoMergeCommand = async (mergeId: number): Promise<void> => {
  const result = await undoMerge(mergeId, 'cli', `cli-undo-${mergeId}`);
  console.log(
    result.replayed
      ? `[merge] слияние #${mergeId} уже отменено этой командой`
      : `[merge] слияние #${mergeId} отменено, восстановлено изменений: ${result.restoredMoves}`,
  );
};

/** Понятный вывод доменных ошибок слияния. true — ошибка распознана и напечатана. */
export const sendMergeCliError = (err: unknown): boolean => {
  if (err instanceof MergeBlockedError) {
    console.error('[merge] заблокировано:');
    for (const c of err.conflicts) console.error(`  [${c.code}] ${c.message}`);
  } else if (err instanceof EntityVersionConflictError || err instanceof MergeIdempotencyMismatchError || err instanceof MergeNotFoundError || err instanceof MergePreviewStaleError) {
    console.error(`[merge] ${err.message}`);
  } else if (err instanceof UnsafeUndoError) {
    console.error(`[merge] ${err.message}`);
    for (const c of err.plan.changes) {
      console.error(`  ${c.dependency}: добавлено ${c.added.length}, изменено/убрано ${c.removed.length}`);
    }
    for (const step of err.plan.steps) console.error(`  - ${step}`);
  } else {
    return false;
  }
  return true;
};
