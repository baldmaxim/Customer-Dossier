// Фрагменты текста редакции. Контракт offsets (ADR-003): символы Unicode
// (code points) строки document_revisions.body, полуинтервал [start, end).
// Тот же счёт использует PostgreSQL substring(), поэтому совпадение цитаты с
// фрагментом проверяет сама база. Эмодзи — один символ, суррогатные пары JS
// не разрываются.

export interface ICodePointSpan {
  start: number;
  end: number;
}

export interface IEvidenceSpan extends ICodePointSpan {
  quote: string;
  contextBefore: string;
  contextAfter: string;
}

export const CONTEXT_CHARS = 80;

const codePoints = (text: string): string[] => Array.from(text);

/** Фрагмент по offsets в code points; null — выход за границы. */
export const sliceByCodePoints = (body: string, span: ICodePointSpan): IEvidenceSpan | null => {
  const chars = codePoints(body);
  if (span.start < 0 || span.end <= span.start || span.end > chars.length) return null;
  return {
    start: span.start,
    end: span.end,
    quote: chars.slice(span.start, span.end).join(''),
    contextBefore: chars.slice(Math.max(0, span.start - CONTEXT_CHARS), span.start).join(''),
    contextAfter: chars.slice(span.end, span.end + CONTEXT_CHARS).join(''),
  };
};

/**
 * Все точные вхождения цитаты (без нормализации исходника). Вызывающий код
 * не вправе молча брать первое: при нескольких вхождениях нужна позиция
 * из извлечения либо решение человека.
 */
export const findQuoteSpans = (body: string, quote: string): ICodePointSpan[] => {
  if (quote.length === 0) return [];
  const spans: ICodePointSpan[] = [];
  const quoteLength = codePoints(quote).length;
  let from = 0;
  for (;;) {
    const index = body.indexOf(quote, from);
    if (index === -1) break;
    const start = codePoints(body.slice(0, index)).length;
    spans.push({ start, end: start + quoteLength });
    // Следующий поиск — со следующей кодовой единицы: перекрывающиеся вхождения тоже считаются.
    from = index + 1;
  }
  return spans;
};

export type QuoteLocation =
  | { kind: 'unique'; span: IEvidenceSpan }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; count: number };

/** Однозначное положение цитаты или причина, по которой его нет. */
export const locateQuote = (body: string, quote: string): QuoteLocation => {
  const spans = findQuoteSpans(body, quote);
  if (spans.length === 0) return { kind: 'not_found' };
  if (spans.length > 1) return { kind: 'ambiguous', count: spans.length };
  const span = sliceByCodePoints(body, spans[0]!);
  return span ? { kind: 'unique', span } : { kind: 'not_found' };
};
