// Личность публикации и каноническая форма текста редакции.
//
// Личность — это (источник, ключ публикации), а не хэш текста: один текст в
// трёх каналах — три публикации, а исправленный пост — та же публикация.

import { createHash } from 'node:crypto';

/**
 * Параметры, которые только помечают переход и никогда не меняют статью.
 * Список закрытый: неизвестный параметр (id, page, article, p…) остаётся —
 * удалить содержательный параметр значит склеить разные статьи.
 */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'yclid',
  'gclid',
  'fbclid',
  '_openstat',
  'mc_cid',
  'mc_eid',
]);

/**
 * Канонический URL публикации: нижний регистр схемы и хоста, без порта по
 * умолчанию, без фрагмента и без известных tracking-параметров. Порядок и
 * значения остальных параметров сохраняются, путь не трогается.
 */
export const canonicalizeUrl = (raw: string): string | null => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.username = '';
  url.password = '';
  const kept = [...url.searchParams.entries()].filter(([name]) => !TRACKING_PARAMS.has(name.toLowerCase()));
  url.search = '';
  for (const [name, value] of kept) url.searchParams.append(name, value);

  // URL уже приводит схему и хост к нижнему регистру и убирает порт по умолчанию.
  return url.toString();
};

export type ItemKeyKind = 'external_id' | 'canonical_url' | 'text_hash';

export interface IItemIdentity {
  key: string;
  kind: ItemKeyKind;
  externalId: string | null;
  canonicalUrl: string | null;
}

const looksLikeUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim());

/**
 * Ключ публикации внутри источника:
 *  1. внешний id источника (Telegram channel/123, guid ленты);
 *  2. иначе канонический URL (в том числе guid, который сам является URL);
 *  3. иначе хэш текста — у ручной вставки без адреса другой личности нет.
 */
export const itemIdentity = (input: { externalId: string | null; url: string | null; body: string }): IItemIdentity => {
  const externalId = input.externalId?.trim() || null;
  const canonicalFromUrl = input.url ? canonicalizeUrl(input.url) : null;

  if (externalId && !looksLikeUrl(externalId)) {
    return { key: `ext:${externalId}`, kind: 'external_id', externalId, canonicalUrl: canonicalFromUrl };
  }

  const canonical = (externalId ? canonicalizeUrl(externalId) : null) ?? canonicalFromUrl;
  if (canonical) {
    return { key: `url:${canonical}`, kind: 'canonical_url', externalId, canonicalUrl: canonical };
  }

  return {
    key: `text:${revisionHash(input.body).toString('hex')}`,
    kind: 'text_hash',
    externalId,
    canonicalUrl: null,
  };
};

/**
 * Каноническая форма текста редакции: NFC, переводы строк LF, без хвостовых
 * пробелов в строках и по краям. Разница только в этом — не новая редакция;
 * любое другое изменение символов — новая.
 */
export const canonicalRevisionText = (body: string): string =>
  body
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t ]+$/u, ''))
    .join('\n')
    .trim();

export const revisionHash = (body: string): Buffer =>
  createHash('sha256').update(canonicalRevisionText(body), 'utf8').digest();
