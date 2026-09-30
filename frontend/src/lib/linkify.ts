// Ссылки в тексте поста: http(s)-адреса становятся кликабельными, остальное — обычный текст.
//
// Только разбиение строки на части: разметку строит React (PostText), текст источника никогда
// не попадает в HTML как разметка. Схема — только http/https: «javascript:» и прочее остаются
// текстом, потому что в регулярку просто не попадают.

export type TextPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

/** Адрес до пробела или кавычки-ёлочки: в постах ссылку обычно закрывает «». */
const URL_RE = /https?:\/\/[^\s<>"'«»]+/giu;

/** Знаки, которыми предложение заканчивается сразу после ссылки: в адрес они не входят. */
const TRAILING = /[.,;:!?…)\]]+$/u;

/** Отрезать хвостовую пунктуацию; закрывающую скобку оставить, если в адресе есть открывающая. */
const trimTrailing = (raw: string): string => {
  const tail = TRAILING.exec(raw)?.[0] ?? '';
  if (tail === '') return raw;
  let url = raw.slice(0, raw.length - tail.length);
  // «https://ru.wikipedia.org/wiki/Мост_(значения)» — скобка часть адреса.
  if (tail.startsWith(')') && url.includes('(') && !url.includes(')')) url += ')';
  return url;
};

export const splitLinks = (text: string): TextPart[] => {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const href = trimTrailing(match[0]);
    // После обрезки остался один протокол — это не адрес.
    if (/^https?:\/\/$/iu.test(href)) continue;
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) });
    parts.push({ kind: 'link', text: href, href });
    last = start + href.length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
};
