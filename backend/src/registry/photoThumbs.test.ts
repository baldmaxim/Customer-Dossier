import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadSharp } from '../utils/sharp.js';
import { parseThumbWidth, photoThumb } from './photoThumbs.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tginfo-thumbs-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const jpeg = async (width: number, height: number): Promise<string> => {
  const sharp = await loadSharp();
  const file = path.join(dir, `${width}x${height}.jpg`);
  const buffer = await sharp(Buffer.alloc(width * height * 3, 128), { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
  fs.writeFileSync(file, buffer);
  return file;
};

describe('уменьшенное фото объекта', () => {
  it('ширина — только из списка', () => {
    expect(parseThumbWidth('640')).toBe(640);
    expect(parseThumbWidth('641')).toBeNull();
    expect(parseThumbWidth(undefined)).toBeNull();
    expect(parseThumbWidth(['640'])).toBeNull();
  });

  it('JPEG 1280 px → WebP 640 px; повтор — из памяти; меньший снимок не растягивается', async () => {
    const sharp = await loadSharp();
    const big = await jpeg(1280, 720);
    const first = await photoThumb(big, 640);
    expect(await sharp(first).metadata()).toMatchObject({ format: 'webp', width: 640, height: 360 });
    expect(await photoThumb(big, 640)).toBe(first);

    const small = await jpeg(400, 300);
    expect(await sharp(await photoThumb(small, 640)).metadata()).toMatchObject({ format: 'webp', width: 400 });
  });
});
