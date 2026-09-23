// Курсор keyset-пагинации лент: "<ISO-время>|<id>".
//
// pg отдаёт timestamptz объектом Date, и строка `${date}|${id}` превращалась в
// "Wed Sep 23 2026 10:00:00 GMT+0300 (Москва…)|42" — PostgreSQL такой курсор не
// разбирает, и «Показать ещё» падало на второй странице. Время — только ISO в UTC.

export const keysetCursor = (at: Date | string, id: number): string =>
  `${at instanceof Date ? at.toISOString() : new Date(at).toISOString()}|${id}`;

/** Разбор курсора. Неразборчивый — как отсутствующий: лента начнётся сначала, а не упадёт. */
export const parseKeysetCursor = (raw: string | undefined): [string | null, number | null] => {
  if (!raw) return [null, null];
  const [at, id] = raw.split('|');
  const time = at ? new Date(at) : null;
  const n = Number.parseInt(id ?? '', 10);
  if (!time || Number.isNaN(time.getTime()) || !Number.isSafeInteger(n)) return [null, null];
  return [time.toISOString(), n];
};
