// Фото публикаций Telegram (06.10.2026): картинки постов из t.me/s/ — сжатой копией файлом в TG_PHOTO_DIR.
//
//  - Веб-версия показывает фото и обложки видео картинкой с CDN Telegram (cdn*.telesco.pe) — обычный GET
//    без ключей. Самого видео и файлов в веб-версии нет.
//  - Хранится копия для показа, а не оригинал (решение владельца: полный формат не нужен): до 1280 px по
//    длинной стороне, WebP, без метаданных — EXIF с координатами съёмки не сохраняется.
//  - Не в базе и не в редакции: адрес на CDN меняется от запроса к запросу, и в редакции он делал бы каждое
//    перечитывание «правкой»; тысячи картинок раздули бы базу и каждую резервную копию. Фото — не сведения
//    и не доказательство: в цитаты, разбор и канон не идёт.
//  - Ключ — номер публикации (source_items.id): путь из данных источника не собирается. Картинки поста —
//    как при первом сохранении: правка поста их не заменяет.
//  - Сбой картинки не останавливает сбор текста: пост уже сохранён, картинка добирается, когда страница
//    перечитывается снова (окно перепроверки), не больше MAX_ATTEMPTS раз.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Sharp, SharpOptions } from 'sharp';

import { env } from '../../config/env.js';
import { NetworkPolicyError, safeFetchBytes, type SafeTransport } from '../../net/safeFetch.js';
import { MAX_POST_IMAGES, TELEGRAM_CDN_POLICY, type ITelegramImage } from '../telegramWeb.js';

/** Длинная сторона копии: пост на экране — до 600 px, на ретине — до 1200 px. */
export const IMAGE_MAX_SIDE = 1280;
export const IMAGE_QUALITY = 70;
/** Больше пикселей — не фото поста; защита декодера от «бомбы» в несколько килобайт. */
export const IMAGE_MAX_INPUT_PIXELS = 40_000_000;
/** Между запросами к CDN: картинки одного поста не уходят залпом. */
export const CDN_DELAY_MS = 500;
/** Попыток на картинку: битая ссылка не дёргает CDN каждую перепроверку, пока пост на первой странице. */
export const MAX_ATTEMPTS = 3;

const META_VERSION = 'tg-photo@1';
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

type SharpFactory = (input: Buffer, options: SharpOptions) => Sharp;
let sharpFactory: Promise<SharpFactory> | null = null;

/**
 * sharp — нативная библиотека: грузится при первой картинке, а не при старте API. Не загрузилась (нет сборки
 * под платформу) — падают только картинки, сбор текста и портал работают.
 */
const loadSharp = (): Promise<SharpFactory> => {
  sharpFactory ??= import('sharp').then(({ default: sharp }) => {
    // Один процесс API: сжатие по одной картинке, без кэша libvips — память контейнера ограничена.
    sharp.cache(false);
    sharp.concurrency(1);
    return (input, options) => sharp(input, options);
  });
  return sharpFactory;
};

export interface IPostImageMeta {
  /** Порядок в посте, с нуля. */
  n: number;
  kind: ITelegramImage['kind'];
  status: 'saved' | 'failed';
  attempts: number;
  width: number | null;
  height: number | null;
  bytes: number | null;
  /** sha256 сжатой копии — ETag при выдаче. */
  sha256: string | null;
  error: string | null;
}

export interface IPostImagesMeta {
  version: typeof META_VERSION;
  /** Сколько картинок нашлось в посте при последнем чтении. */
  total: number;
  images: IPostImageMeta[];
  updatedAt: string;
}

export interface IImageStats {
  saved: number;
  failed: number;
  /** Последняя ошибка файловой системы (нет прав на каталог, кончился диск): картинки не пишутся вовсе. */
  storageError?: string;
}

export const photosEnabled = (dir: string = env.TG_PHOTO_DIR): boolean => dir !== '';

const validItem = (itemId: number): boolean => Number.isSafeInteger(itemId) && itemId > 0;
const validIndex = (n: number): boolean => Number.isInteger(n) && n >= 0 && n < MAX_POST_IMAGES;

/** Тысяча публикаций на папку: сотни тысяч файлов в одном каталоге неудобны для обслуживания. */
const itemDir = (itemId: number, dir: string): string => path.join(dir, String(Math.floor(itemId / 1000)));
const metaPath = (itemId: number, dir: string): string => path.join(itemDir(itemId, dir), `${itemId}.json`);
const imagePath = (itemId: number, n: number, dir: string): string => path.join(itemDir(itemId, dir), `${itemId}-${n}.webp`);

const writeAtomic = (file: string, data: Buffer | string): void => {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o644 });
  fs.renameSync(tmp, file);
};

export const readPostImages = (itemId: number, dir: string = env.TG_PHOTO_DIR): IPostImagesMeta | null => {
  if (!photosEnabled(dir) || !validItem(itemId)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath(itemId, dir), 'utf8')) as IPostImagesMeta;
    return meta.version === META_VERSION && Array.isArray(meta.images) ? meta : null;
  } catch {
    return null;
  }
};

/** Файл сохранённой картинки или null. */
export const postImageFile = (itemId: number, n: number, dir: string = env.TG_PHOTO_DIR): { file: string; meta: IPostImageMeta } | null => {
  if (!validIndex(n)) return null;
  const meta = readPostImages(itemId, dir)?.images.find(i => i.n === n && i.status === 'saved');
  if (!meta) return null;
  const file = imagePath(itemId, n, dir);
  return fs.existsSync(file) ? { file, meta } : null;
};

/** Сжатая копия: поворот по EXIF, до IMAGE_MAX_SIDE по длинной стороне, WebP без метаданных. */
export const compressImage = async (input: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> => {
  const sharp = await loadSharp();
  const options: SharpOptions = { limitInputPixels: IMAGE_MAX_INPUT_PIXELS, failOn: 'error', autoOrient: true };
  const { format } = await sharp(input, options).metadata();
  if (!format || !ACCEPTED_FORMATS.has(format)) throw new Error(`формат ${format ?? 'не распознан'} — не фото`);
  const { data, info } = await sharp(input, options)
    .resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: IMAGE_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height };
};

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

const describeError = (err: unknown): string => {
  if (err instanceof NetworkPolicyError) return `${err.kind}: ${err.message}`;
  return err instanceof Error ? err.message.slice(0, 200) : 'ошибка';
};

const downloadImage = async (url: string, userAgent: string, transport: SafeTransport | undefined): Promise<Buffer> => {
  const res = await safeFetchBytes(url, TELEGRAM_CDN_POLICY, { headers: { 'user-agent': userAgent } }, transport ? { transport } : {});
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const type = String(res.headers['content-type'] ?? '');
  if (type !== '' && !type.toLowerCase().startsWith('image/')) throw new Error(`ответ ${type.split(';')[0]} — не картинка`);
  if (res.body.length === 0) throw new Error('пустой ответ');
  return res.body;
};

export interface ISavePostImagesOptions {
  dir?: string;
  transport?: SafeTransport;
  delayMs?: number;
  now?: Date;
  userAgent?: string;
}

/**
 * Скачать и сжать картинки публикаций. Уже сохранённые и исчерпавшие попытки не запрашиваются — повторное
 * чтение страницы без новых картинок в сеть не ходит. Ошибка одной картинки остаётся в заметке поста.
 */
export const savePostImages = async (
  posts: ReadonlyArray<{ itemId: number; images: readonly ITelegramImage[] }>,
  options: ISavePostImagesOptions = {},
): Promise<IImageStats> => {
  const dir = options.dir ?? env.TG_PHOTO_DIR;
  const stats: IImageStats = { saved: 0, failed: 0 };
  if (!photosEnabled(dir)) return stats;
  const delayMs = options.delayMs ?? CDN_DELAY_MS;
  const userAgent = options.userAgent ?? env.INGEST_USER_AGENT;
  let requests = 0;

  for (const post of posts) {
    if (!validItem(post.itemId) || post.images.length === 0) continue;
    const prior = readPostImages(post.itemId, dir);
    const byIndex = new Map((prior?.images ?? []).map(i => [i.n, i]));
    const pending = post.images
      .slice(0, MAX_POST_IMAGES)
      .map((image, n) => ({ image, n, before: byIndex.get(n) }))
      .filter(({ before }) => !before || (before.status === 'failed' && before.attempts < MAX_ATTEMPTS));
    if (pending.length === 0 && prior?.total === post.images.length) continue;

    for (const { image, n, before } of pending) {
      if (requests > 0) await sleep(delayMs);
      requests += 1;
      const attempts = (before?.attempts ?? 0) + 1;
      try {
        const compressed = await compressImage(await downloadImage(image.url, userAgent, options.transport));
        fs.mkdirSync(itemDir(post.itemId, dir), { recursive: true });
        writeAtomic(imagePath(post.itemId, n, dir), compressed.bytes);
        byIndex.set(n, {
          n,
          kind: image.kind,
          status: 'saved',
          attempts,
          width: compressed.width,
          height: compressed.height,
          bytes: compressed.bytes.length,
          sha256: createHash('sha256').update(compressed.bytes).digest('hex'),
          error: null,
        });
        stats.saved += 1;
      } catch (err) {
        byIndex.set(n, { n, kind: image.kind, status: 'failed', attempts, width: null, height: null, bytes: null, sha256: null, error: describeError(err) });
        stats.failed += 1;
      }
    }
    const meta: IPostImagesMeta = {
      version: META_VERSION,
      total: Math.min(post.images.length, MAX_POST_IMAGES),
      images: [...byIndex.values()].sort((a, b) => a.n - b.n),
      updatedAt: (options.now ?? new Date()).toISOString(),
    };
    try {
      fs.mkdirSync(itemDir(post.itemId, dir), { recursive: true });
      writeAtomic(metaPath(post.itemId, dir), JSON.stringify(meta));
    } catch (err) {
      // Заметка не записалась — картинки поста доберутся заново при следующем чтении; сбор текста не прерывается.
      stats.storageError = describeError(err);
    }
  }
  return stats;
};

/** Для экрана: сохранённые картинки поста и сколько не сохранилось. null — у поста картинок не записано. */
export const postImagesView = (
  itemId: number,
  dir: string = env.TG_PHOTO_DIR,
): { items: Array<{ n: number; kind: ITelegramImage['kind']; width: number; height: number }>; missing: number } | null => {
  const meta = readPostImages(itemId, dir);
  if (!meta) return null;
  const items = meta.images.flatMap(i =>
    i.status === 'saved' && i.width !== null && i.height !== null && fs.existsSync(imagePath(itemId, i.n, dir))
      ? [{ n: i.n, kind: i.kind, width: i.width, height: i.height }]
      : [],
  );
  return { items, missing: Math.max(0, meta.total - items.length) };
};
