// Фото публикаций Telegram без сети: сжатие, заметка поста, попытки, чужой хост, путь только из номеров.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SafeTransport } from '../../net/safeFetch.js';
import {
  IMAGE_MAX_SIDE,
  MAX_ATTEMPTS,
  compressImage,
  postImageFile,
  postImagesView,
  readPostImages,
  savePostImages,
} from './photos.js';

const jpeg = (width: number, height: number): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r: 180, g: 60, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'секрет фотографа' } })
    .toBuffer();

const CDN = 'https://cdn4.telesco.pe/file/';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-photos-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Транспорт-заглушка: считает запросы, отвечает по адресу. */
const transportOf = (answer: (url: URL) => { status: number; type: string; body: Buffer }): { transport: SafeTransport; calls: string[] } => {
  const calls: string[] = [];
  const transport: SafeTransport = async url => {
    calls.push(url.toString());
    const a = answer(url);
    return { status: a.status, headers: { 'content-type': a.type }, body: a.body };
  };
  return { transport, calls };
};

describe('compressImage', () => {
  it('уменьшает до длинной стороны, WebP, без EXIF', async () => {
    const out = await compressImage(await jpeg(2000, 1000));
    expect(out).toMatchObject({ width: IMAGE_MAX_SIDE, height: 640 });
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
  });

  it('маленькую картинку не увеличивает', async () => {
    expect(await compressImage(await jpeg(300, 200))).toMatchObject({ width: 300, height: 200 });
  });

  it('SVG и не картинка — отказ', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await expect(compressImage(svg)).rejects.toThrow(/не фото/);
    await expect(compressImage(Buffer.from('<html>ошибка</html>'))).rejects.toThrow();
  });
});

describe('savePostImages', () => {
  it('сохраняет картинки поста; повторное чтение в сеть не ходит', async () => {
    const image = await jpeg(1600, 1200);
    const { transport, calls } = transportOf(() => ({ status: 200, type: 'image/jpeg', body: image }));
    const posts = [
      { itemId: 4321, images: [{ kind: 'photo' as const, url: `${CDN}a.jpg` }, { kind: 'video' as const, url: `${CDN}b.jpg` }] },
      { itemId: 4322, images: [] },
    ];

    expect(await savePostImages(posts, { dir, transport, delayMs: 0 })).toEqual({ saved: 2, failed: 0 });
    expect(calls).toHaveLength(2);
    expect(fs.existsSync(path.join(dir, '4', '4321-0.webp'))).toBe(true);
    expect(readPostImages(4321, dir)).toMatchObject({ total: 2, images: [{ n: 0, status: 'saved', kind: 'photo' }, { n: 1, kind: 'video' }] });
    expect(postImagesView(4321, dir)).toEqual({
      items: [
        { n: 0, kind: 'photo', width: 1280, height: 960 },
        { n: 1, kind: 'video', width: 1280, height: 960 },
      ],
      missing: 0,
    });
    expect(postImagesView(4322, dir)).toBeNull();

    expect(await savePostImages(posts, { dir, transport, delayMs: 0 })).toEqual({ saved: 0, failed: 0 });
    expect(calls).toHaveLength(2);
  });

  it('сбой — в заметке, не больше MAX_ATTEMPTS попыток', async () => {
    const { transport, calls } = transportOf(() => ({ status: 404, type: 'text/html', body: Buffer.from('нет') }));
    const posts = [{ itemId: 7, images: [{ kind: 'photo' as const, url: `${CDN}gone.jpg` }] }];
    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) await savePostImages(posts, { dir, transport, delayMs: 0 });

    expect(calls).toHaveLength(MAX_ATTEMPTS);
    expect(readPostImages(7, dir)?.images[0]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, error: 'HTTP 404' });
    expect(postImagesView(7, dir)).toEqual({ items: [], missing: 1 });
    expect(postImageFile(7, 0, dir)).toBeNull();
  });

  it('чужой хост и не картинка — не сохраняются', async () => {
    const { transport, calls } = transportOf(() => ({ status: 200, type: 'text/html; charset=utf-8', body: Buffer.from('<html>') }));
    const posts = [
      {
        itemId: 8,
        images: [
          { kind: 'photo' as const, url: 'https://evil.example/x.jpg' },
          { kind: 'photo' as const, url: `${CDN}page.jpg` },
        ],
      },
    ];
    expect(await savePostImages(posts, { dir, transport, delayMs: 0 })).toEqual({ saved: 0, failed: 2 });
    expect(calls).toEqual([`${CDN}page.jpg`]);
    const meta = readPostImages(8, dir);
    expect(meta?.images[0]?.error).toMatch(/host_not_allowed/);
    expect(meta?.images[1]?.error).toMatch(/не картинка/);
  });

  it('без каталога — ничего не делает', async () => {
    const { transport, calls } = transportOf(() => ({ status: 200, type: 'image/jpeg', body: Buffer.alloc(1) }));
    expect(await savePostImages([{ itemId: 1, images: [{ kind: 'photo', url: `${CDN}a.jpg` }] }], { dir: '', transport })).toEqual({ saved: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('postImageFile', () => {
  it('только номера: чужой индекс и id не дают пути', async () => {
    const image = await jpeg(100, 100);
    const { transport } = transportOf(() => ({ status: 200, type: 'image/jpeg', body: image }));
    await savePostImages([{ itemId: 12, images: [{ kind: 'photo', url: `${CDN}a.jpg` }] }], { dir, transport, delayMs: 0 });

    expect(postImageFile(12, 0, dir)?.file).toBe(path.join(dir, '0', '12-0.webp'));
    expect(postImageFile(12, 0, dir)?.meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const [id, n] of [
      [12, 1],
      [12, -1],
      [12, 10],
      [12, Number.NaN],
      [0, 0],
      [-12, 0],
      [1.5, 0],
    ] as const) {
      expect(postImageFile(id, n, dir)).toBeNull();
    }
  });
});

describe('savePostImages — сбой хранилища', () => {
  it('каталог недоступен для записи: исключения нет, ошибка в статистике', async () => {
    const image = await jpeg(100, 100);
    const { transport } = transportOf(() => ({ status: 200, type: 'image/jpeg', body: image }));
    const blocked = path.join(dir, 'file-not-dir');
    fs.writeFileSync(blocked, 'x');
    const stats = await savePostImages([{ itemId: 5, images: [{ kind: 'photo', url: `${CDN}a.jpg` }] }], { dir: blocked, transport, delayMs: 0 });
    expect(stats).toMatchObject({ saved: 0, failed: 1 });
    expect(stats.storageError).toBeTruthy();
  });
});
