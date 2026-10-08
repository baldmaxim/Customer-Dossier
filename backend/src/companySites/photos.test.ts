// Фото проектов с сайта компании без сети и базы: чьё фото (alt, подпись карточки, og:image страницы проекта),
// скачивание с того же сайта, сжатая копия, попытки, мелкая картинка — не фото, выключенный каталог — ничего.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IPageImages } from '../ingest/companySite/images.js';
import type { ISiteProject } from '../llm/siteProjects/schema.js';
import type { SafeTransport } from '../net/safeFetch.js';
import {
  MAX_ATTEMPTS,
  photoIdOf,
  pickProjectPhotos,
  readSitePageImages,
  readSitePhotos,
  runSitePhotoPass,
  saveSitePageImages,
  sitePhotoFile,
  sitePhotoViews,
  type IPhotoPage,
  type ISitePhotoDeps,
} from './photos.js';
import { projectKey } from './projects.js';

const SITE = 'https://demo.ru';
const img = (file: string, alt = '', caption = ''): IPageImages['images'][number] => ({ url: `${SITE}/upload/${file}`, alt, caption });
const page = (url: string, over: Partial<IPhotoPage> = {}): IPhotoPage => ({ url: `${SITE}${url}`, home: false, og: null, images: [], projects: [], ...over });
const named = (...names: string[]): Array<{ name: string }> => names.map(name => ({ name }));

describe('чьё фото', () => {
  it('карточка: название в подписи; alt с одним названием главнее подписи; два названия — ничьё', () => {
    const picks = pickProjectPhotos([
      page('/', {
        home: true,
        og: `${SITE}/upload/site.jpg`,
        projects: named('ЖК «Остров»', 'Квартал Берег', 'Символ'),
        images: [
          img('ostrov.jpg', '', 'ЖК «Остров» Москва, сдача 2027'),
          img('bereg.jpg', 'Квартал Берег', 'Остров и Берег рядом'),
          img('both.jpg', '', 'Остров и Символ — два проекта'),
          img('hero.jpg'),
        ],
      }),
    ]);
    expect(picks.map(p => [p.name, p.imageUrl.split('/').pop(), p.how])).toEqual([
      ['Квартал Берег', 'bereg.jpg', 'card'],
      ['ЖК «Остров»', 'ostrov.jpg', 'card'],
    ]);
  });

  it('страница проекта: её og:image главнее карточки; og главной и общий для страниц og — не фото проекта', () => {
    const picks = pickProjectPhotos([
      page('/', { home: true, og: `${SITE}/upload/home.jpg`, projects: named('ЖК «Остров»'), images: [img('card-ostrov.jpg', '', 'ЖК «Остров»')] }),
      page('/zhk/ostrov', { og: `${SITE}/upload/ostrov-og.jpg`, projects: named('Остров') }),
      page('/zhk/bereg', { og: `${SITE}/upload/common.jpg`, projects: named('Берег') }),
      page('/zhk/simvol', { og: `${SITE}/upload/common.jpg`, projects: named('Символ') }),
      page('/catalog', { og: `${SITE}/upload/catalog.jpg`, projects: named('Берег', 'Символ') }),
    ]);
    expect(picks).toEqual([
      { key: projectKey('ЖК «Остров»'), name: 'ЖК «Остров»', imageUrl: `${SITE}/upload/ostrov-og.jpg`, pageUrl: `${SITE}/zhk/ostrov`, how: 'page' },
    ]);
  });

  it('одна картинка — одному проекту; слово короче трёх букв и часть слова — не название', () => {
    const picks = pickProjectPhotos([
      page('/', {
        projects: named('Остров', 'ЖК Ос', 'Парк'),
        images: [img('a.jpg', 'Остров'), img('a2.jpg', '', 'Остров'), img('b.jpg', '', 'Паркинг у дома'), img('c.jpg', '', 'Ос')],
      }),
    ]);
    expect(picks.map(p => [p.name, p.imageUrl.split('/').pop()])).toEqual([['Остров', 'a.jpg']]);
  });

  it('без проектов — ничего', () => {
    expect(pickProjectPhotos([page('/', { images: [img('a.jpg', 'Остров')] })])).toEqual([]);
  });
});

const jpeg = (width: number, height: number): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 } } })
    .jpeg()
    .toBuffer();

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-photos-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const transportOf = (answer: (url: URL) => { status: number; type: string; body: Buffer }) => {
  const calls: Array<{ url: string; referer: string | undefined }> = [];
  const transport: SafeTransport = async (url, request) => {
    calls.push({ url: url.toString(), referer: request.headers?.referer });
    const a = answer(url);
    return { status: a.status, headers: { 'content-type': a.type }, body: a.body };
  };
  return { transport, calls };
};

const PROJECTS: ISiteProject[] = [
  { name: 'ЖК «Остров»', city: null, address: null, status: 'selling', completion: null, quote: 'ЖК «Остров»' },
  { name: 'Квартал Берег', city: null, address: null, status: 'planned', completion: null, quote: 'Квартал Берег' },
];

const depsOf = (projects: ISiteProject[] = PROJECTS, homepage = `${SITE}/`): ISitePhotoDeps => ({
  sources: async () => [{ id: 7, config: { version: 1, mode: 'company_site', homepage } }],
  pageProjects: async (_sourceId, urls) => new Map(urls.map(u => [u, projects])),
});

const storePages = (): void =>
  saveSitePageImages(
    7,
    [{ url: `${SITE}/`, home: true, og: null, images: [img('ostrov.jpg', '', 'ЖК «Остров» в продаже'), img('bereg.jpg', 'Квартал Берег')] }],
    dir,
  );

describe('проход фото', () => {
  it('скачивает с того же сайта с Referer страницы, хранит WebP и заметку; повтор в сеть не ходит', async () => {
    storePages();
    expect(readSitePageImages(7, dir)?.pages).toHaveLength(1);
    const image = await jpeg(1600, 1000);
    const { transport, calls } = transportOf(() => ({ status: 200, type: 'image/jpeg', body: image }));

    const runs = await runSitePhotoPass({ dir, transport, delayMs: 0, deps: depsOf() });
    expect(runs).toEqual([{ sourceId: 7, host: 'demo.ru', saved: 2, failed: 0 }]);
    expect(calls).toEqual([
      { url: `${SITE}/upload/bereg.jpg`, referer: `${SITE}/` },
      { url: `${SITE}/upload/ostrov.jpg`, referer: `${SITE}/` },
    ]);

    const id = photoIdOf(projectKey('ЖК «Остров»'));
    const saved = sitePhotoFile(7, id, dir);
    expect(saved?.meta).toMatchObject({ status: 'saved', how: 'card', width: 1280, height: 800, imageUrl: `${SITE}/upload/ostrov.jpg` });
    expect((await sharp(fs.readFileSync(saved!.file)).metadata()).format).toBe('webp');
    expect(sitePhotoViews(7, dir).get(projectKey('ЖК «Остров»'))).toEqual({ sourceId: 7, id, width: 1280, height: 800 });

    expect(await runSitePhotoPass({ dir, transport, delayMs: 0, deps: depsOf() })).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('предел запросов за проход — по всем сайтам; остальное — следующим проходом', async () => {
    storePages();
    const image = await jpeg(800, 600);
    const { transport, calls } = transportOf(() => ({ status: 200, type: 'image/jpeg', body: image }));
    await runSitePhotoPass({ dir, transport, delayMs: 0, limit: 1, deps: depsOf() });
    expect(calls).toHaveLength(1);
    await runSitePhotoPass({ dir, transport, delayMs: 0, limit: 1, deps: depsOf() });
    expect(calls).toHaveLength(2);
    expect(Object.values(readSitePhotos(7, dir)).map(p => p.status)).toEqual(['saved', 'saved']);
  });

  it('неудача — до MAX_ATTEMPTS раз; мелкая картинка и не картинка — не фото', async () => {
    storePages();
    const small = await jpeg(120, 90);
    const { transport, calls } = transportOf(url =>
      url.pathname.endsWith('ostrov.jpg') ? { status: 200, type: 'text/html', body: Buffer.from('<html>') } : { status: 200, type: 'image/jpeg', body: small },
    );
    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) await runSitePhotoPass({ dir, transport, delayMs: 0, deps: depsOf() });
    expect(calls).toHaveLength(2 * MAX_ATTEMPTS);
    const photos = readSitePhotos(7, dir);
    expect(photos[photoIdOf(projectKey('ЖК «Остров»'))]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, error: 'ответ text/html — не картинка' });
    expect(photos[photoIdOf(projectKey('Квартал Берег'))]?.error).toMatch(/120×90 — меньше 240×160/);
    expect(sitePhotoViews(7, dir).size).toBe(0);
  });

  it('другой адрес картинки после исчерпанных попыток — пробуется заново', async () => {
    storePages();
    const { transport, calls } = transportOf(() => ({ status: 404, type: 'text/html', body: Buffer.from('нет') }));
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await runSitePhotoPass({ dir, transport, delayMs: 0, deps: depsOf([PROJECTS[0]!]) });
    expect(calls).toHaveLength(MAX_ATTEMPTS);
    saveSitePageImages(7, [{ url: `${SITE}/`, home: true, og: null, images: [img('ostrov-new.jpg', 'ЖК «Остров»')] }], dir);
    await runSitePhotoPass({ dir, transport, delayMs: 0, deps: depsOf([PROJECTS[0]!]) });
    expect(calls.at(-1)?.url).toBe(`${SITE}/upload/ostrov-new.jpg`);
    expect(readSitePhotos(7, dir)[photoIdOf(projectKey('ЖК «Остров»'))]).toMatchObject({ attempts: 1, status: 'failed' });
  });

  it('каталог не задан — ни заметок, ни запросов; чужой номер фото — null', async () => {
    const { transport, calls } = transportOf(() => ({ status: 200, type: 'image/jpeg', body: Buffer.alloc(1) }));
    saveSitePageImages(7, [], '');
    expect(await runSitePhotoPass({ dir: '', transport, deps: depsOf() })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(sitePhotoFile(7, '../../etc/passwd', dir)).toBeNull();
    expect(sitePhotoFile(7, photoIdOf('нет'), dir)).toBeNull();
  });
});
