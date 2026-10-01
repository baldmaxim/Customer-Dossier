/** Спецсимволы LIKE в запросе — буквы, а не шаблон: «50%» ищет «50%», а не всё подряд. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
