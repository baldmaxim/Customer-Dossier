// Фото объектов ДОМ.РФ на диске: запись целиком (временный файл и переименование), заметка об исходнике,
// только JPEG и только разумного размера, имя — номер объекта (цифры), без каталога — выключено.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PHOTO_MAX_BYTES, hasPhoto, photoFile, photosEnabled, readPhotoMeta, savePhoto } from './photos.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
let dir = '';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tginfo-photos-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('фото объектов ДОМ.РФ', () => {
  it('без каталога — выключено: ни файла, ни заметки', () => {
    expect(photosEnabled('')).toBe(false);
    expect(hasPhoto('71431', '')).toBe(false);
    expect(readPhotoMeta('71431', '')).toBeNull();
  });

  it('снимок пишется файлом с заметкой: откуда, sha256, размеры, когда', () => {
    const meta = savePhoto('71431', { bytes: JPEG, width: 1280, height: 720, originalUrl: 'https://наш.дом.рф/resizer/image?x' }, dir, new Date('2026-10-02T12:00:00Z'));
    expect(hasPhoto('71431', dir)).toBe(true);
    expect(photoFile('71431', dir)).toBe(path.join(dir, '71431.jpg'));
    expect(fs.readFileSync(path.join(dir, '71431.jpg'))).toEqual(JPEG);
    expect(readPhotoMeta('71431', dir)).toEqual(meta);
    expect(meta).toMatchObject({ width: 1280, height: 720, bytes: JPEG.length, capturedAt: '2026-10-02T12:00:00.000Z' });
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });

  it('не JPEG, пустой и слишком большой снимок не записываются', () => {
    expect(() => savePhoto('1', { bytes: Buffer.from('<html>'), width: 1, height: 1, originalUrl: 'x' }, dir)).toThrow(/не JPEG/);
    expect(() => savePhoto('1', { bytes: Buffer.alloc(0), width: 1, height: 1, originalUrl: 'x' }, dir)).toThrow(/вне пределов/);
    const huge = Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES)]);
    expect(() => savePhoto('1', { bytes: huge, width: 1, height: 1, originalUrl: 'x' }, dir)).toThrow(/вне пределов/);
    expect(hasPhoto('1', dir)).toBe(false);
  });

  it('имя файла — только номер объекта: путь из данных не собирается', () => {
    expect(() => savePhoto('../etc/passwd', { bytes: JPEG, width: 1, height: 1, originalUrl: 'x' }, dir)).toThrow(/только цифры/);
    expect(photoFile('../71431', dir)).toBeNull();
  });
});
