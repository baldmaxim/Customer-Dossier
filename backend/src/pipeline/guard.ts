// Блокировка изменения legacy-канона.
//
// Старый apply сначала удаляет вклад документа (упоминания, события, роли)
// и пишет новый: любой переразбор старым путём может стереть роль,
// подтверждённую другим источником. Безопасный путь записи — новый конвейер
// (этап 03B, reprocess/*), поэтому legacy-операции выключены в коде, а не
// просьбой в инструкции. Чтение существующей базы остаётся доступным.
//
// Слияние сущностей (этап 04) — отдельный безопасный путь (resolve/entityMerge.ts)
// с предпросмотром, журналом и отменой; его применение включается флагом
// MERGE_APPLY_ENABLED и по умолчанию выключено.

import { env } from '../config/env.js';

export const CANON_WRITE_BLOCK_REASON =
  'изменение канона старым путём заблокировано: legacy apply удаляет прежний вклад документа ' +
  'и может стереть подтверждённые сведения; используйте новый конвейер (--reextract/--publish)';

export const MERGE_BLOCK_REASON =
  'применение слияния выключено (MERGE_APPLY_ENABLED=false): предпросмотр и история доступны, ' +
  'запись — только после явного включения';

export const DELETE_WITH_DOCUMENTS_BLOCK_REASON =
  'удаление источника вместе с документами заблокировано: оно уносит упоминания и события ' +
  'и оставляет роли без доказательств. Поставьте источник на паузу';

export class CanonWriteBlockedError extends Error {
  constructor(readonly reason: string = CANON_WRITE_BLOCK_REASON) {
    super(reason);
    this.name = 'CanonWriteBlockedError';
  }
}

/**
 * Разрешающего режима для legacy-записи нет. Флаг — константа, а не переменная окружения:
 * старый apply не возвращается.
 */
const CANON_WRITES_UNLOCKED = false;

/** Вызывается до любого запроса к БД в изменяющих канон путях. */
export const assertCanonWriteAllowed = (): void => {
  if (!CANON_WRITES_UNLOCKED) throw new CanonWriteBlockedError();
};

/** Применение и отмена слияния — только при MERGE_APPLY_ENABLED=true. */
export const assertMergeAllowed = (enabled: boolean = env.MERGE_APPLY_ENABLED): void => {
  if (!enabled) throw new CanonWriteBlockedError(MERGE_BLOCK_REASON);
};
