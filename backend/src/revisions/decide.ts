// Что делать с очередным наблюдением публикации. Чистая функция.
//
// Правила:
//  - текст совпал с текущей редакцией — только наблюдение;
//  - текст другой и наблюдение не старее текущего состояния — новая редакция,
//    становится текущей (A → B → A даёт три редакции, а не возврат к первой);
//  - текст другой, но наблюдение заведомо старее текущего состояния (по дате
//    изменения от источника или, если её нет, по времени получения) — редакция
//    сохраняется как увиденная, но текущей не становится: поздно пришедший
//    старый ответ не объявляется новым состоянием источника.

export type ObservationOutcome = 'new_item' | 'new_revision' | 'unchanged' | 'stale';
export type Chronology = 'source_modified_at' | 'observed_order' | 'unknown';

export interface ILatestState {
  bodyHashHex: string;
  sourceModifiedAt: Date | null;
  /** Когда было получено наблюдение, установившее текущее состояние. */
  stateObservedAt: Date | null;
}

export interface IIncomingState {
  bodyHashHex: string;
  sourceModifiedAt: Date | null;
  fetchedAt: Date;
}

export interface IRevisionDecision {
  outcome: ObservationOutcome;
  /** Нужна ли новая строка document_revisions (иначе ссылаемся на существующую). */
  createsRevision: boolean;
  /** Становится ли наблюдаемый текст текущим состоянием публикации. */
  movesLatest: boolean;
  chronology: Chronology;
}

export const decideRevision = (
  latest: ILatestState | null,
  incoming: IIncomingState,
  /** Есть ли уже редакция с таким же текстом (для старых наблюдений). */
  existingRevisionWithSameText: boolean,
): IRevisionDecision => {
  if (latest === null) {
    return {
      outcome: 'new_item',
      createsRevision: true,
      movesLatest: true,
      chronology: incoming.sourceModifiedAt ? 'source_modified_at' : 'observed_order',
    };
  }

  if (latest.bodyHashHex === incoming.bodyHashHex) {
    return { outcome: 'unchanged', createsRevision: false, movesLatest: true, chronology: 'observed_order' };
  }

  const bothModified = latest.sourceModifiedAt !== null && incoming.sourceModifiedAt !== null;
  const olderByModified = bothModified && incoming.sourceModifiedAt! < latest.sourceModifiedAt!;
  const olderByFetch =
    !bothModified && latest.stateObservedAt !== null && incoming.fetchedAt < latest.stateObservedAt;

  if (olderByModified || olderByFetch) {
    return {
      outcome: 'stale',
      // Старый текст, который уже есть среди редакций, не дублируется.
      createsRevision: !existingRevisionWithSameText,
      movesLatest: false,
      chronology: olderByModified ? 'source_modified_at' : 'unknown',
    };
  }

  return {
    outcome: 'new_revision',
    createsRevision: true,
    movesLatest: true,
    chronology: bothModified ? 'source_modified_at' : 'observed_order',
  };
};
