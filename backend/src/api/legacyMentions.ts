// Legacy-упоминания (`mentions`) — старые данные, где утверждений нового конвейера ещё нет. В неё пишет только
// заблокированный `pipeline/apply.ts`, поэтому строки никогда не снимаются. Документ, переразобранный новым конвейером
// (у публикации есть активный набор), своё упоминание теряет: иначе пост, где новый разбор компанию не нашёл,
// оставался бы в её ленте и счётчике, а под ним — старая роль. Это то же правило, что у card_participations_v и
// card_events_v (replaced_legacy_documents_v, миграции 017 и 036); каждое чтение `mentions` для экрана — через него.

/** Условие «упоминание ещё живо» для строки mentions под псевдонимом alias. */
export const liveMentionSql = (alias: string): string =>
  `${alias}.document_id NOT IN (SELECT document_id FROM replaced_legacy_documents_v)`;
