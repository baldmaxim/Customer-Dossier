// sharp — нативная библиотека: грузится при первой картинке, а не при старте API. Не загрузилась (нет сборки под
// платформу) — падают только картинки, сбор текста и портал работают. Один загрузчик на процесс: картинки постов
// Telegram (ingest/telegram/photos.ts) и уменьшенные фото объектов ДОМ.РФ (registry/photoThumbs.ts).

import type { Sharp, SharpOptions } from 'sharp';

export type SharpFactory = (input: Buffer, options?: SharpOptions) => Sharp;

let sharpFactory: Promise<SharpFactory> | null = null;

export const loadSharp = (): Promise<SharpFactory> => {
  sharpFactory ??= import('sharp').then(({ default: sharp }) => {
    // Один процесс API: сжатие по одной картинке, без кэша libvips — память контейнера ограничена.
    sharp.cache(false);
    sharp.concurrency(1);
    return (input, options) => sharp(input, options);
  });
  return sharpFactory;
};
