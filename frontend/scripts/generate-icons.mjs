// Генерация растровых иконок из одного SVG. PNG руками не правим.
//
//   npm run icons:generate
//
// Фон непрозрачный: прозрачный PNG на iOS «Домой» даёт чёрный квадрат.
// Maskable-вариант с полями ~10 %, иначе Android обрежет углы по своей маске.

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '..', 'public');
const SOURCE = path.join(PUBLIC_DIR, 'favicon.svg');

/** Из background_color манифеста. */
const BACKGROUND = '#f7f8fa';

const TARGETS = [
  { file: 'favicon-32.png', size: 32 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'apple-touch-icon-120.png', size: 120 },
  { file: 'apple-touch-icon-152.png', size: 152 },
  { file: 'apple-touch-icon-167.png', size: 167 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
];

const run = async () => {
  const svg = await readFile(SOURCE);
  await mkdir(PUBLIC_DIR, { recursive: true });

  for (const target of TARGETS) {
    await sharp(svg, { density: 384 })
      .resize(target.size, target.size, { fit: 'contain', background: BACKGROUND })
      .flatten({ background: BACKGROUND })
      .png()
      .toFile(path.join(PUBLIC_DIR, target.file));
    console.log(`[icons] ${target.file} ${target.size}×${target.size}`);
  }

  // Maskable: рисунок ужимаем до 80 % и центрируем — Android режет по кругу.
  const inner = Math.round(512 * 0.8);
  const pad = Math.round((512 - inner) / 2);
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: BACKGROUND },
  })
    .composite([
      { input: await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer(), top: pad, left: pad },
    ])
    .png()
    .toFile(path.join(PUBLIC_DIR, 'icon-512-maskable.png'));
  console.log('[icons] icon-512-maskable.png 512×512 (поля 10 %)');
};

run().catch(err => {
  console.error('[icons] не удалось:', err.message);
  process.exit(1);
});
