// Фото проектов с сайта компании (08.10.2026): картинка проекта со страниц подтверждённого сайта — сжатой копией
// файлом в SITE_PHOTO_DIR, как картинки постов Telegram (ingest/telegram/photos.ts).
//
//  - Чьё фото. Чтение сайта (ingest/companySite/crawler.ts) запоминает картинки прочитанных страниц — og:image и
//    картинки с подписью рядом (ingest/companySite/images.ts). Проекты называет модель позже (site-projects@1),
//    поэтому сопоставление — здесь, по последнему ответу модели о каждой странице (тем же правилом, что «С сайта
//    компании», readModel.ts). Фото принадлежит проекту, если в alt картинки или в подписи её карточки названо
//    только оно, либо страница целиком о нём (не главная, проект на ней один) — тогда её og:image,
//    если та же картинка не стоит на других страницах (картинка всего сайта). Не угадываем: без фото лучше, чем с чужим.
//  - Откуда. Только с того же сайта и его поддоменов (политика чтения сайта): картинку с чужого хоста не скачиваем.
//  - Когда. Проход в тике сбора при действующем допуске сбора: не больше PHOTOS_PER_PASS запросов, с паузой сайта
//    между ними. Сохранённое фото проекта не перезапрашивается; неудача — до MAX_ATTEMPTS раз на адрес картинки.
//  - Что хранится. Копия до 1280 px WebP без метаданных и заметка сайта photos.json; в базе ничего. Фото — не
//    сведения и не доказательство: в канон, цитаты и резервную копию не идёт. Имя файла — хэш ключа названия
//    проекта (projectKey), каталог — номер источника: путь из данных сайта не собирается.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import type { IPageImages } from '../ingest/companySite/images.js';
import { companySitePolicy, parseCompanySiteProfile, siteHost, type ICompanySiteProfile } from '../ingest/companySite/profile.js';
import { approvedPolicySql } from '../ingest/policy.js';
import { compressImage, describeImageError, downloadImage } from '../ingest/telegram/photos.js';
import type { ISiteProject } from '../llm/siteProjects/schema.js';
import type { SafeTransport } from '../net/safeFetch.js';
import { normalizeName } from '../resolve/normalize.js';
import { latestSitePages, projectKey } from './projects.js';

/** Запросов картинок за проход сбора — по всем сайтам вместе: проход сбора общий с каналами. */
export const PHOTOS_PER_PASS = 6;
/** Попыток на адрес картинки: сменился адрес — счёт заново. */
export const MAX_ATTEMPTS = 3;
/** Меньше — значок или превью, а не фото проекта. */
export const MIN_WIDTH = 240;
export const MIN_HEIGHT = 160;
/** Короче — не название, а слово: «Дом» нашёлся бы в любой подписи. */
const NAME_MIN_CHARS = 3;

const PAGES_VERSION = 'site-page-images@1';
const PHOTOS_VERSION = 'site-photo@1';

export interface IStoredPageImages {
  version: typeof PAGES_VERSION;
  readAt: string;
  pages: IPageImages[];
}

export interface ISitePhotoMeta {
  id: string;
  /** projectKey названия. */
  key: string;
  name: string;
  imageUrl: string;
  pageUrl: string;
  /** page — og:image страницы проекта; card — карточка с названием. */
  how: 'page' | 'card';
  status: 'saved' | 'failed';
  attempts: number;
  width: number | null;
  height: number | null;
  bytes: number | null;
  /** sha256 сжатой копии — ETag при выдаче. */
  sha256: string | null;
  error: string | null;
  updatedAt: string;
}

interface IStoredPhotos {
  version: typeof PHOTOS_VERSION;
  photos: Record<string, ISitePhotoMeta>;
}

/** Фото проекта для карточки: адрес — /api/site-photos/:sourceId/:id. */
export interface ISitePhotoView {
  sourceId: number;
  id: string;
  width: number;
  height: number;
}

export const sitePhotosEnabled = (dir: string = env.SITE_PHOTO_DIR): boolean => dir !== '';

const PHOTO_ID = /^[0-9a-f]{16}$/;

export const photoIdOf = (key: string): string => createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);

const validSource = (sourceId: number): boolean => Number.isSafeInteger(sourceId) && sourceId > 0;
const sourceDir = (sourceId: number, dir: string): string => path.join(dir, String(sourceId));
const pagesPath = (sourceId: number, dir: string): string => path.join(sourceDir(sourceId, dir), 'pages.json');
const photosPath = (sourceId: number, dir: string): string => path.join(sourceDir(sourceId, dir), 'photos.json');
const photoPath = (sourceId: number, id: string, dir: string): string => path.join(sourceDir(sourceId, dir), `${id}.webp`);

const writeAtomic = (file: string, data: Buffer | string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o644 });
  fs.renameSync(tmp, file);
};

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

/** Картинки страниц последнего чтения сайта: заменяют прежние целиком, как страницы прохода в readModel. */
export const saveSitePageImages = (sourceId: number, pages: readonly IPageImages[], dir: string = env.SITE_PHOTO_DIR, now: Date = new Date()): void => {
  if (!sitePhotosEnabled(dir) || !validSource(sourceId)) return;
  const stored: IStoredPageImages = { version: PAGES_VERSION, readAt: now.toISOString(), pages: [...pages] };
  writeAtomic(pagesPath(sourceId, dir), JSON.stringify(stored));
};

export const readSitePageImages = (sourceId: number, dir: string = env.SITE_PHOTO_DIR): IStoredPageImages | null => {
  if (!sitePhotosEnabled(dir) || !validSource(sourceId)) return null;
  const stored = readJson<IStoredPageImages>(pagesPath(sourceId, dir));
  return stored?.version === PAGES_VERSION && Array.isArray(stored.pages) ? stored : null;
};

export const readSitePhotos = (sourceId: number, dir: string = env.SITE_PHOTO_DIR): Record<string, ISitePhotoMeta> => {
  if (!sitePhotosEnabled(dir) || !validSource(sourceId)) return {};
  const stored = readJson<IStoredPhotos>(photosPath(sourceId, dir));
  return stored?.version === PHOTOS_VERSION && stored.photos && typeof stored.photos === 'object' ? stored.photos : {};
};

/** Файл сохранённого фото или null. */
export const sitePhotoFile = (sourceId: number, id: string, dir: string = env.SITE_PHOTO_DIR): { file: string; meta: ISitePhotoMeta } | null => {
  if (!PHOTO_ID.test(id)) return null;
  const meta = readSitePhotos(sourceId, dir)[id];
  if (!meta || meta.status !== 'saved') return null;
  const file = photoPath(sourceId, id, dir);
  return fs.existsSync(file) ? { file, meta } : null;
};

/** Сохранённые фото сайта по ключу названия проекта — для карточки. */
export const sitePhotoViews = (sourceId: number, dir: string = env.SITE_PHOTO_DIR): Map<string, ISitePhotoView> => {
  const views = new Map<string, ISitePhotoView>();
  for (const meta of Object.values(readSitePhotos(sourceId, dir))) {
    if (meta.status !== 'saved' || meta.width === null || meta.height === null || !fs.existsSync(photoPath(sourceId, meta.id, dir))) continue;
    views.set(meta.key, { sourceId, id: meta.id, width: meta.width, height: meta.height });
  }
  return views;
};

// ─── Чьё фото ────────────────────────────────────────────────────────────────────────────────

const words = (text: string): string => ` ${text.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** Название целыми словами: как написано и без «ЖК» и кавычек. */
const nameForms = (name: string): string[] => {
  const forms = [name, normalizeName(name, 'project').display].map(words).filter(f => f.trim().length >= NAME_MIN_CHARS);
  return [...new Set(forms)];
};

export interface IPhotoPage extends IPageImages {
  /** Проекты последнего принятого ответа модели об этой странице. */
  projects: readonly Pick<ISiteProject, 'name'>[];
}

export interface IPhotoPick {
  key: string;
  name: string;
  imageUrl: string;
  pageUrl: string;
  how: ISitePhotoMeta['how'];
}

/**
 * Какое фото чьё. Кандидаты по весу: og:image страницы проекта, картинка с названием в alt, картинка с названием
 * в подписи; при равенстве — что раньше на сайте. У проекта одно фото, одна картинка — у одного проекта.
 */
export const pickProjectPhotos = (pages: readonly IPhotoPage[]): IPhotoPick[] => {
  const projects = new Map<string, { name: string; forms: string[] }>();
  for (const page of pages) {
    for (const p of page.projects) {
      const key = projectKey(p.name);
      if (key.length >= 2 && !projects.has(key)) projects.set(key, { name: p.name, forms: nameForms(p.name) });
    }
  }
  if (projects.size === 0) return [];
  const named = (text: string): string[] => {
    if (text === '') return [];
    const flat = words(text);
    return [...projects.entries()].filter(([, p]) => p.forms.some(f => flat.includes(f))).map(([key]) => key);
  };
  // og:image на нескольких страницах — картинка сайта, а не проекта.
  const ogPages = new Map<string, number>();
  for (const page of pages) if (page.og) ogPages.set(page.og, (ogPages.get(page.og) ?? 0) + 1);

  const proposals: Array<IPhotoPick & { weight: number; order: number }> = [];
  for (const page of pages) {
    const own = [...new Set(page.projects.map(p => projectKey(p.name)).filter(k => projects.has(k)))];
    if (!page.home && own.length === 1 && page.og && ogPages.get(page.og) === 1) {
      const key = own[0]!;
      proposals.push({ key, name: projects.get(key)!.name, imageUrl: page.og, pageUrl: page.url, how: 'page', weight: 3, order: proposals.length });
    }
    for (const image of page.images) {
      // alt — о самой картинке, подпись — о блоке вокруг: alt с одним названием решает. Два названия — раздел или
      // слайдер, а не карточка проекта.
      const byAlt = named(image.alt);
      const byCaption = byAlt.length === 0 ? named(image.caption) : [];
      const key = byAlt.length === 1 ? byAlt[0] : byCaption.length === 1 ? byCaption[0] : undefined;
      if (!key) continue;
      proposals.push({ key, name: projects.get(key)!.name, imageUrl: image.url, pageUrl: page.url, how: 'card', weight: byAlt.length === 1 ? 2 : 1, order: proposals.length });
    }
  }
  proposals.sort((a, b) => b.weight - a.weight || a.order - b.order);
  const picks: IPhotoPick[] = [];
  const usedImages = new Set<string>();
  for (const p of proposals) {
    if (usedImages.has(p.imageUrl) || picks.some(pick => pick.key === p.key)) continue;
    usedImages.add(p.imageUrl);
    picks.push({ key: p.key, name: p.name, imageUrl: p.imageUrl, pageUrl: p.pageUrl, how: p.how });
  }
  return picks;
};

// ─── Проход ──────────────────────────────────────────────────────────────────────────────────

export interface ISitePhotoSource {
  id: number;
  config: Record<string, unknown>;
}

/** База — за интерфейсом: сопоставление, попытки и запись проверяются без неё. */
export interface ISitePhotoDeps {
  /** Сайты компаний с действующим допуском сбора. */
  sources: () => Promise<ISitePhotoSource[]>;
  /** Проекты последнего принятого ответа модели о каждой странице (по адресу). */
  pageProjects: (sourceId: number, urls: string[]) => Promise<Map<string, ISiteProject[]>>;
}

export const SITE_PHOTO_PG_DEPS: ISitePhotoDeps = {
  sources: () =>
    query<ISitePhotoSource>(
      `SELECT s.id, s.config FROM sources s
       WHERE s.config->>'mode' = 'company_site' AND ${approvedPolicySql('s', 'collect')}
       ORDER BY s.id`,
    ),
  pageProjects: async (sourceId, urls) => new Map((await latestSitePages(sourceId, urls)).map(p => [p.url, p.projects ?? []])),
};

export interface ISitePhotoPassOptions {
  dir?: string;
  limit?: number;
  transport?: SafeTransport;
  /** Пауза между картинками одного сайта; по умолчанию — пауза из профиля сайта. */
  delayMs?: number;
  now?: Date;
  userAgent?: string;
  deps?: ISitePhotoDeps;
}

export interface ISitePhotoRun {
  sourceId: number;
  host: string;
  saved: number;
  failed: number;
  /** Не записалась заметка сайта (нет прав, кончился диск): фото этого прохода доберутся заново. */
  storageError?: string;
}

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

const due = (pick: IPhotoPick, before: ISitePhotoMeta | undefined): boolean =>
  !before || (before.status === 'failed' && (before.imageUrl !== pick.imageUrl || before.attempts < MAX_ATTEMPTS));

export const runSitePhotoPass = async (options: ISitePhotoPassOptions = {}): Promise<ISitePhotoRun[]> => {
  const dir = options.dir ?? env.SITE_PHOTO_DIR;
  if (!sitePhotosEnabled(dir)) return [];
  const deps = options.deps ?? SITE_PHOTO_PG_DEPS;
  const userAgent = options.userAgent ?? env.INGEST_USER_AGENT;
  let budget = options.limit ?? PHOTOS_PER_PASS;
  const runs: ISitePhotoRun[] = [];

  for (const source of await deps.sources()) {
    if (budget <= 0) break;
    const stored = readSitePageImages(source.id, dir);
    if (!stored || stored.pages.length === 0) continue;
    let profile: ICompanySiteProfile;
    try {
      profile = parseCompanySiteProfile(source.config);
    } catch {
      continue;
    }
    const projects = await deps.pageProjects(source.id, stored.pages.map(p => p.url));
    const photos = readSitePhotos(source.id, dir);
    const pending = pickProjectPhotos(stored.pages.map(p => ({ ...p, projects: projects.get(p.url) ?? [] }))).filter(pick =>
      due(pick, photos[photoIdOf(pick.key)]),
    );
    if (pending.length === 0) continue;

    const policy = companySitePolicy(profile);
    const run: ISitePhotoRun = { sourceId: source.id, host: siteHost(profile.homepage), saved: 0, failed: 0 };
    for (const [i, pick] of pending.entries()) {
      if (budget <= 0) break;
      if (i > 0) await sleep(options.delayMs ?? profile.limits.delayMs);
      budget -= 1;
      const id = photoIdOf(pick.key);
      const before = photos[id];
      const attempts = before?.imageUrl === pick.imageUrl ? before.attempts + 1 : 1;
      const base = { id, key: pick.key, name: pick.name, imageUrl: pick.imageUrl, pageUrl: pick.pageUrl, how: pick.how, attempts };
      const updatedAt = (options.now ?? new Date()).toISOString();
      try {
        // Referer — страница, где картинка стоит: так её запрашивает и браузер, защита от «хотлинка» не срабатывает.
        const bytes = await downloadImage(pick.imageUrl, policy, { 'user-agent': userAgent, referer: pick.pageUrl }, options.transport);
        const copy = await compressImage(bytes);
        if (copy.width < MIN_WIDTH || copy.height < MIN_HEIGHT) {
          throw new Error(`картинка ${copy.width}×${copy.height} — меньше ${MIN_WIDTH}×${MIN_HEIGHT}, не фото проекта`);
        }
        writeAtomic(photoPath(source.id, id, dir), copy.bytes);
        photos[id] = {
          ...base,
          status: 'saved',
          width: copy.width,
          height: copy.height,
          bytes: copy.bytes.length,
          sha256: createHash('sha256').update(copy.bytes).digest('hex'),
          error: null,
          updatedAt,
        };
        run.saved += 1;
      } catch (err) {
        photos[id] = { ...base, status: 'failed', width: null, height: null, bytes: null, sha256: null, error: describeImageError(err), updatedAt };
        run.failed += 1;
      }
    }
    try {
      writeAtomic(photosPath(source.id, dir), JSON.stringify({ version: PHOTOS_VERSION, photos } satisfies IStoredPhotos));
    } catch (err) {
      run.storageError = describeImageError(err);
    }
    runs.push(run);
  }
  return runs;
};
