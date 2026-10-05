// Фото объектов с ДОМ.РФ (02.10.2026, ADR-012 п. 35): главный снимок со страницы объекта, уменьшенный в
// браузере работника, — файлом в каталоге REGISTRY_PHOTO_DIR, рядом — заметка: откуда снят и когда.
//
// Не в базе: тысячи снимков раздули бы базу и каждую резервную копию, а фото — не сведения, его всегда
// можно снять с сайта заново. Не в тексте снимка и не в payload: рендер должен оставаться детерминированным,
// иначе каждое перечитывание давало бы новую редакцию. Имя файла — номер объекта ДОМ.РФ (только цифры):
// путь из данных пользователя не собирается.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { env } from '../config/env.js';

/** Больше — не фото карточки: 1280 px JPEG укладывается в 300–500 КБ. */
export const PHOTO_MAX_BYTES = 1_500_000;
/** Ширина, до которой снимок уменьшается в браузере: карточка — до 600 px, паспорт — до 1200 px на ретине. */
export const PHOTO_MAX_WIDTH = 1280;

/** На странице объекта галереи нет — повторная проверка не раньше, чем через столько дней. */
export const NO_PHOTO_RECHECK_DAYS = 7;

export interface IPhotoMeta {
  /** Адрес исходного снимка на сайте: тот же адрес при перечитывании — снимок не скачивается заново. */
  originalUrl: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  capturedAt: string;
}

const REF = /^[0-9]{1,18}$/;

export const photosEnabled = (dir: string = env.REGISTRY_PHOTO_DIR): boolean => dir !== '';

const paths = (externalRef: string, dir: string): { image: string; meta: string } => {
  if (!REF.test(externalRef)) throw new Error(`номер объекта ДОМ.РФ — только цифры: «${externalRef}»`);
  return { image: path.join(dir, `${externalRef}.jpg`), meta: path.join(dir, `${externalRef}.json`) };
};

export const photoFile = (externalRef: string, dir: string = env.REGISTRY_PHOTO_DIR): string | null => {
  if (!photosEnabled(dir) || !REF.test(externalRef)) return null;
  const { image } = paths(externalRef, dir);
  return fs.existsSync(image) ? image : null;
};

export const hasPhoto = (externalRef: string, dir: string = env.REGISTRY_PHOTO_DIR): boolean => photoFile(externalRef, dir) !== null;

export const readPhotoMeta = (externalRef: string, dir: string = env.REGISTRY_PHOTO_DIR): IPhotoMeta | null => {
  if (!photosEnabled(dir) || !REF.test(externalRef)) return null;
  try {
    return JSON.parse(fs.readFileSync(paths(externalRef, dir).meta, 'utf8')) as IPhotoMeta;
  } catch {
    return null;
  }
};

/** Записать снимок: сначала во временный файл, потом переименованием — читатель не увидит половину файла. */
export const savePhoto = (
  externalRef: string,
  input: { bytes: Buffer; width: number; height: number; originalUrl: string },
  dir: string = env.REGISTRY_PHOTO_DIR,
  now: Date = new Date(),
): IPhotoMeta => {
  if (!photosEnabled(dir)) throw new Error('каталог фото не задан (REGISTRY_PHOTO_DIR)');
  if (input.bytes.length === 0 || input.bytes.length > PHOTO_MAX_BYTES) throw new Error(`снимок ${input.bytes.length} байт — вне пределов`);
  // JPEG начинается с FF D8 FF: иначе это не тот файл (страница ошибки, пустой ответ).
  if (input.bytes[0] !== 0xff || input.bytes[1] !== 0xd8 || input.bytes[2] !== 0xff) throw new Error('снимок — не JPEG');
  fs.mkdirSync(dir, { recursive: true });
  const target = paths(externalRef, dir);
  const meta: IPhotoMeta = {
    originalUrl: input.originalUrl,
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
    width: input.width,
    height: input.height,
    bytes: input.bytes.length,
    capturedAt: now.toISOString(),
  };
  const tmp = `${target.image}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, input.bytes, { mode: 0o644 });
  fs.renameSync(tmp, target.image);
  fs.writeFileSync(`${target.meta}.tmp`, JSON.stringify(meta), { mode: 0o644 });
  fs.renameSync(`${target.meta}.tmp`, target.meta);
  return meta;
};

/** Галереи на странице нет: заметка без снимка, чтобы добор фото не открывал страницу каждый проход. */
export const markNoPhoto = (externalRef: string, dir: string = env.REGISTRY_PHOTO_DIR, now: Date = new Date()): void => {
  if (!photosEnabled(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
  const target = paths(externalRef, dir);
  fs.writeFileSync(`${target.meta}.tmp`, JSON.stringify({ noPhoto: true, checkedAt: now.toISOString() }), { mode: 0o644 });
  fs.renameSync(`${target.meta}.tmp`, target.meta);
};

/**
 * Нужен ли объекту добор фото: снимка нет и галерею не проверяли последние NO_PHOTO_RECHECK_DAYS дней.
 * Объекты, снятые до появления фото (02.10.2026), иначе ждали бы перечитывания раз в неделю.
 */
export const needsPhoto = (externalRef: string, dir: string = env.REGISTRY_PHOTO_DIR, now: Date = new Date()): boolean => {
  if (!photosEnabled(dir) || !REF.test(externalRef) || hasPhoto(externalRef, dir)) return false;
  try {
    const meta = JSON.parse(fs.readFileSync(paths(externalRef, dir).meta, 'utf8')) as { noPhoto?: boolean; checkedAt?: string };
    if (meta.noPhoto && meta.checkedAt) return now.getTime() - Date.parse(meta.checkedAt) > NO_PHOTO_RECHECK_DAYS * 86_400_000;
  } catch {
    // заметки нет — проверяли никогда
  }
  return true;
};
