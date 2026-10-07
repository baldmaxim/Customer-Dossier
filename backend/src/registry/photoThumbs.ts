// Уменьшенное фото объекта для карточек (07.10.2026). Работник ДОМ.РФ хранит главный снимок JPEG до 1280 px
// (registry/photos.ts), а карточка в сетке объектов — около 320 px: телефон качал в 5–10 раз больше, чем показывал,
// и вкладка «Объекты» бывает на сотни карточек. Копия — WebP по ширине, считается при первом запросе и держится в
// памяти процесса (не больше THUMB_CACHE_MAX); каталог фото у API только для чтения, на диск она не пишется.

import fs from 'node:fs/promises';

import { loadSharp } from '../utils/sharp.js';
import { ttlCache } from '../utils/ttlCache.js';

/** Ширины, которые отдаёт портал: карточка в сетке — до ~320 px CSS, на ретине вдвое. */
export const THUMB_WIDTHS = [640] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

const THUMB_QUALITY = 70;
/** ~40 КБ на копию — до ~12 МБ памяти. */
const THUMB_CACHE_MAX = 300;

export const parseThumbWidth = (raw: unknown): ThumbWidth | null => {
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  return (THUMB_WIDTHS as readonly number[]).includes(n) ? (n as ThumbWidth) : null;
};

const thumbs = ttlCache(
  async (key: { file: string; width: ThumbWidth; version: string }): Promise<Buffer> => {
    const sharp = await loadSharp();
    return sharp(await fs.readFile(key.file))
      .resize({ width: key.width, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
  },
  { ttlMs: 24 * 3_600_000, max: THUMB_CACHE_MAX, keyOf: k => `${k.file}|${k.width}|${k.version}` },
);

/** Копия файла по ширине; версия — время изменения и размер: переснятый снимок даёт новую копию. */
export const photoThumb = async (file: string, width: ThumbWidth): Promise<Buffer> => {
  const stat = await fs.stat(file);
  return thumbs.get({ file, width, version: `${stat.mtimeMs}:${stat.size}` });
};
