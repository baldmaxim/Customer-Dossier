// Генерация растровых иконок из SVG-исходников. PNG руками не правим.
//
//   npm run icons:generate
//
// Источники:
//   public/favicon.svg           — плитка со скруглением, для вкладки и iOS
//   public/favicon-maskable.svg  — заливка во весь квадрат, для маски Android
//
// Фон непрозрачный: прозрачный PNG на iOS «Домой» даёт чёрный квадрат.
// Фон берём фирменный, а не цвет страницы: iOS и Android режут иконку по своей
// форме, и светлая рамка по краям выглядела бы браком.

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '..', 'public');
const SOURCE = path.join(PUBLIC_DIR, 'favicon.svg');
const SOURCE_MASKABLE = path.join(PUBLIC_DIR, 'favicon-maskable.svg');

/** Средний тон градиента плитки — им заполняем углы и поля. */
const BACKGROUND = '#2f5ae4';

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
  const svgMaskable = await readFile(SOURCE_MASKABLE);
  await mkdir(PUBLIC_DIR, { recursive: true });

  for (const target of TARGETS) {
    await sharp(svg, { density: 384 })
      .resize(target.size, target.size, { fit: 'contain', background: BACKGROUND })
      .flatten({ background: BACKGROUND })
      .png()
      .toFile(path.join(PUBLIC_DIR, target.file));
    console.log(`[icons] ${target.file} ${target.size}×${target.size}`);
  }

  // Maskable: рисунок уже сведён в безопасную зону внутри самого SVG, поэтому
  // заливаем весь квадрат — Android обрежет по своей маске без белых углов.
  await sharp(svgMaskable, { density: 384 })
    .resize(512, 512, { fit: 'cover', background: BACKGROUND })
    .flatten({ background: BACKGROUND })
    .png()
    .toFile(path.join(PUBLIC_DIR, 'icon-512-maskable.png'));
  console.log('[icons] icon-512-maskable.png 512×512 (безопасная зона внутри SVG)');
};

run().catch(err => {
  console.error('[icons] не удалось:', err.message);
  process.exit(1);
});
