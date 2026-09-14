// Нарезка текста редакции на чанки в code points (тот же счёт, что у offsets
// доказательств и у PostgreSQL substring). Диапазоны сохраняются у чанка;
// покрытие считается по объединению реальных диапазонов, с учётом перекрытия.

export const CHUNKER_VERSION = 'chunker@2-codepoints';

export interface IChunkRange {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface ICoverage {
  coveredChars: number;
  totalChars: number;
  complete: boolean;
}

/**
 * Режем по границе абзаца, если она не слишком близко к началу чанка;
 * следующий чанк начинается с перекрытием. Хвост за пределами maxChunks не
 * обрезается молча — он просто не попадает в диапазоны, и покрытие это покажет.
 */
export const planCodePointChunks = (
  body: string,
  chunkSize: number,
  maxChunks: number,
  overlap: number,
): IChunkRange[] => {
  const chars = Array.from(body);
  const total = chars.length;
  if (total === 0) return [];
  if (total <= chunkSize) return [{ index: 0, start: 0, end: total, text: body }];

  const chunks: IChunkRange[] = [];
  let start = 0;
  while (start < total && chunks.length < maxChunks) {
    const hardEnd = Math.min(start + chunkSize, total);
    let end = hardEnd;
    if (hardEnd < total) {
      const window = chars.slice(start, hardEnd);
      const lastBreak = window.lastIndexOf('\n');
      if (lastBreak > chunkSize / 2) end = start + lastBreak;
    }
    chunks.push({ index: chunks.length, start, end, text: chars.slice(start, end).join('') });
    if (end >= total) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
};

/** Покрытие — объединение диапазонов: перекрытие не считается дважды, дыры видны. */
export const computeCoverage = (ranges: ReadonlyArray<{ start: number; end: number }>, totalChars: number): ICoverage => {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let covered = 0;
  let cursor = 0;
  for (const range of sorted) {
    const from = Math.max(range.start, cursor);
    if (range.end > from) {
      covered += range.end - from;
      cursor = range.end;
    }
  }
  // Полное покрытие — ни одной дыры от 0 до конца, а не только сумма длин.
  let reach = 0;
  for (const range of sorted) {
    if (range.start > reach) break;
    reach = Math.max(reach, range.end);
  }
  return { coveredChars: covered, totalChars, complete: totalChars === 0 || reach >= totalChars };
};
