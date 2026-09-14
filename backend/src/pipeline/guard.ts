// Блокировка изменения legacy-канона.
//
// Текущий apply сначала удаляет вклад документа (упоминания, события, роли)
// и пишет новый. Ручных решений и множественных доказательств в схеме пока
// нет, поэтому любой переразбор — массовый или одного документа — может
// стереть роль, подтверждённую другим источником. Слияние компаний не
// проверяет реквизиты и не имеет отката.
//
// До появления безопасного пути (append-only запуски и атомарная публикация —
// этап 03B, безопасное слияние — этап 04) эти операции выключены в коде, а не
// просьбой в инструкции. Чтение существующей базы остаётся доступным.

export const CANON_WRITE_BLOCK_REASON =
  'изменение канона заблокировано до безопасного пути записи (этап 03B): ' +
  'текущий apply удаляет прежний вклад документа и может стереть подтверждённые сведения';

export const MERGE_BLOCK_REASON =
  'слияние заблокировано до этапа 04: нет проверки реквизитов, блокировок и отката';

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
 * Сейчас разрешающего режима нет. Флаг — константа, а не переменная окружения:
 * снять блокировку можно только кодом этапа, который принесёт безопасный путь.
 */
const CANON_WRITES_UNLOCKED = false;

/** Вызывается до любого запроса к БД в изменяющих канон путях. */
export const assertCanonWriteAllowed = (): void => {
  if (!CANON_WRITES_UNLOCKED) throw new CanonWriteBlockedError();
};

export const assertMergeAllowed = (): void => {
  if (!CANON_WRITES_UNLOCKED) throw new CanonWriteBlockedError(MERGE_BLOCK_REASON);
};
