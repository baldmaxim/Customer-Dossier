// Этап 25B на настоящей базе (миграция 046): подтверждённый сайт компании — источник чтения.
// «Это сайт компании» / «Указать вручную» заводит источник site:<хост> и включает сбор и ИИ с основанием и журналом;
// тот же хост у второй компании — тот же источник; «Отвязать» последнего — пауза и отзыв. Подтверждённые до 25B
// получают источник проходом синхронизации. Снимок страницы — только при смене текста и только при допуске;
// источник со снимками не удаляется. Проход модели берёт последний снимок страницы и пишет ответ строкой; карточка
// сверяет проекты сайта с объектами компании; фото проекта берётся по тому же ответу модели и видно в строке
// проекта. Сети и модели нет: ответ модели и картинка подставлены.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { deleteSource } from '../ingest/sources.js';
import { SiteCollectRevokedError, saveSitePage } from '../ingest/companySite/store.js';
import type { SafeTransport } from '../net/safeFetch.js';
import { runSitePhotoPass, saveSitePageImages } from './photos.js';
import { SITE_PROJECTS_PG_DEPS, pagesToExtract, runSiteProjectsPass } from './projects.js';
import { loadCompanySiteProjects } from './readModel.js';
import { syncCompanySiteSources } from './sources.js';
import { confirmSiteCandidate, linkSiteManually, rejectSiteCandidate, saveSiteSearch } from './store.js';

const pool = getPool;
const HOME = 'https://www.demo-stroy.ru/';
const PROJECTS = 'https://www.demo-stroy.ru/projects/';

const company = async (name: string): Promise<number> =>
  (await pool().query<{ id: number }>(`INSERT INTO companies (name, name_norm, name_latin) VALUES ($1, lower($1), lower($1)) RETURNING id`, [name])).rows[0]!.id;

const sourceRow = async (id: number) =>
  (
    await pool().query<{ key: string; status: string; access_status: string; ai_processing_status: string; policy_basis: string | null; poll_interval_sec: number; config: Record<string, unknown> }>(
      'SELECT key, status, access_status, ai_processing_status, policy_basis, poll_interval_sec, config FROM sources WHERE id = $1',
      [id],
    )
  ).rows[0]!;

let alpha = 0;
let beta = 0;
let sourceId = 0;

beforeAll(async () => {
  await resetAndMigrate();
  alpha = await company('Демо-Строй');
  beta = await company('Демо-Строй Групп');
  const projectId = (
    await pool().query<{ id: number }>(`INSERT INTO projects (name, name_norm, name_latin) VALUES ('ЖК Остров-2', 'остров 2', 'ostrov 2') RETURNING id`)
  ).rows[0]!.id;
  await pool().query(`INSERT INTO project_participants (project_id, company_id, role) VALUES ($1, $2, 'customer')`, [projectId, alpha]);
});

afterAll(async () => {
  await closeDb();
});

describe('сайт компании — источник чтения', () => {
  it('«Указать вручную» заводит источник site:<хост> и включает сбор и ИИ с основанием оператора', async () => {
    const linked = await linkSiteManually(alpha, HOME, 'oper');
    expect(linked.sourceId).not.toBeNull();
    sourceId = linked.sourceId!;
    expect(await sourceRow(sourceId)).toMatchObject({
      key: 'site:demo-stroy.ru',
      status: 'active',
      access_status: 'approved',
      ai_processing_status: 'approved',
      policy_basis: 'Сайт компании подтверждён оператором oper',
      poll_interval_sec: 259200,
      config: { mode: 'company_site', homepage: HOME },
    });
    const log = await pool().query('SELECT changed_by FROM source_policy_log WHERE source_id = $1', [sourceId]);
    expect(log.rows).toEqual([{ changed_by: 'oper' }]);
  });

  it('тот же хост у второй компании — тот же источник, не второй', async () => {
    await saveSiteSearch(beta, {
      query: 'q', outcome: 'found', resultCount: 3, model: 'm', promptVersion: 'site-search@1', refreshDays: 90,
      accepted: [{ host: 'demo-stroy.ru', url: HOME, reason: 'в выдаче', title: null, snippet: null }],
    });
    const candidate = (await pool().query<{ id: number }>('SELECT id FROM company_site_candidates WHERE company_id = $1', [beta])).rows[0]!.id;
    expect((await confirmSiteCandidate(candidate, 'oper2')).sourceId).toBe(sourceId);
    expect((await pool().query(`SELECT 1 FROM sources WHERE key LIKE 'site:%'`)).rowCount).toBe(1);
  });

  it('снимок страницы — только при смене текста; источник со снимками не удаляется', async () => {
    expect(await saveSitePage(sourceId, { url: HOME, title: 'Демо-Строй', text: 'Главная. ЖК «Остров» в продаже.' })).toBe('saved');
    expect(await saveSitePage(sourceId, { url: HOME, title: 'Демо-Строй', text: 'Главная. ЖК «Остров» в продаже.' })).toBe('unchanged');
    expect(await saveSitePage(sourceId, { url: PROJECTS, title: 'Проекты', text: 'Проекты: ЖК «Остров» — в продаже, сдача 2027. ЖК «Берег» — скоро старт продаж.' })).toBe('saved');
    expect(await saveSitePage(sourceId, { url: PROJECTS, title: 'Проекты', text: 'Проекты: ЖК «Остров-2» — в продаже, сдача 2027. ЖК «Берег» — скоро старт продаж.' })).toBe('saved');
    const pages = await pool().query('SELECT url FROM company_site_pages WHERE source_id = $1', [sourceId]);
    expect(pages.rowCount).toBe(3);
    expect((await deleteSource(sourceId)).deleted).toBe(false);
    await expect(pool().query('UPDATE company_site_pages SET title = $1 WHERE source_id = $2', ['x', sourceId])).rejects.toThrow();
  });

  it('проход модели — последний снимок каждой страницы; ответ строкой, повтора нет', async () => {
    const pending = await pagesToExtract(10);
    expect(pending.map(p => p.url).sort()).toEqual([HOME, PROJECTS]);
    expect(pending.find(p => p.url === PROJECTS)?.text).toContain('Остров-2');
    const answer = (url: string) =>
      url.includes('/projects/')
        ? [
            { name: 'ЖК «Остров-2»', city: null, address: null, status: 'selling' as const, completion: '2027', quote: 'ЖК «Остров-2» — в продаже, сдача 2027' },
            { name: 'ЖК «Берег»', city: null, address: null, status: 'planned' as const, completion: null, quote: 'ЖК «Берег» — скоро старт продаж' },
          ]
        : [];
    const runs = await runSiteProjectsPass(10, {
      ...SITE_PROJECTS_PG_DEPS,
      caller: async ({ body }) => ({ ok: true, data: { projects: answer(body) }, usage: { tokensIn: 1, tokensOut: 1, latencyMs: 1 }, rawResponse: '{}' }),
    });
    expect(runs.map(r => r.outcome)).toEqual(['saved', 'saved']);
    expect(await pagesToExtract(10)).toEqual([]);
  });

  it('карточка: проекты сайта сверены с объектами компании; «новое» — чего на портале нет', async () => {
    await pool().query(`INSERT INTO source_runs (source_id, status, outcome, coverage) VALUES ($1, 'ok', 'ok', $2::jsonb)`, [
      sourceId,
      JSON.stringify({ mode: 'company_site', pages: [HOME, PROJECTS] }),
    ]);
    await pool().query(`UPDATE sources SET last_ok_at = now() WHERE id = $1`, [sourceId]);
    const read = await loadCompanySiteProjects(alpha);
    expect(read.sites).toEqual([expect.objectContaining({ host: 'demo-stroy.ru', pages: 2, status: 'active' })]);
    expect(read.projects.map(p => [p.name, p.isNew, p.match?.name ?? null])).toEqual([
      ['ЖК «Берег»', true, null],
      ['ЖК «Остров-2»', false, 'ЖК Остров-2'],
    ]);
    expect(read.waiting).toBe(0);
  });

  it('фото проектов: проход берёт тот же ответ модели, что карточка; сохранённое фото — в строке проекта', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-photos-int-'));
    try {
      saveSitePageImages(sourceId, [
        { url: HOME, home: true, og: null, images: [{ url: 'https://www.demo-stroy.ru/upload/ostrov.jpg', alt: 'ЖК «Остров»', caption: '' }] },
        { url: PROJECTS, home: false, og: null, images: [{ url: 'https://www.demo-stroy.ru/upload/bereg.jpg', alt: '', caption: 'ЖК «Берег» скоро' }] },
      ], dir);
      const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
      const calls: string[] = [];
      const transport: SafeTransport = async url => {
        calls.push(url.toString());
        return { status: 200, headers: { 'content-type': 'image/jpeg' }, body: image };
      };
      expect(await runSitePhotoPass({ dir, transport, delayMs: 0 })).toEqual([{ sourceId, host: 'demo-stroy.ru', saved: 1, failed: 0 }]);
      // «Остров» на главной модель не называла: его картинка ничья.
      expect(calls).toEqual(['https://www.demo-stroy.ru/upload/bereg.jpg']);
      const read = await loadCompanySiteProjects(alpha, new Date(), dir);
      expect(read.projects.map(p => [p.name, p.photo ? `${p.photo.width}×${p.photo.height}` : null])).toEqual([
        ['ЖК «Берег»', '800×600'],
        ['ЖК «Остров-2»', null],
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('«Отвязать»: пока сайт подтверждён у другой компании — читается; отвязан последний — пауза и отзыв', async () => {
    const ids = (await pool().query<{ id: number; company_id: number }>('SELECT id, company_id FROM company_site_candidates ORDER BY company_id')).rows;
    await rejectSiteCandidate(ids.find(r => r.company_id === alpha)!.id, 'oper', 'не тот сайт');
    expect((await sourceRow(sourceId)).status).toBe('active');
    await rejectSiteCandidate(ids.find(r => r.company_id === beta)!.id, 'oper', null);
    expect(await sourceRow(sourceId)).toMatchObject({ status: 'paused', access_status: 'revoked', ai_processing_status: 'revoked' });
    await expect(saveSitePage(sourceId, { url: HOME, title: null, text: 'новый текст' })).rejects.toBeInstanceOf(SiteCollectRevokedError);
  });

  it('подтверждённые до 25B получают источник проходом синхронизации', async () => {
    const gamma = await company('Гамма Девелопмент');
    await pool().query(
      `INSERT INTO company_site_candidates (company_id, host, url, found_via, state, decided_by, decided_at)
       VALUES ($1, 'gamma-dev.ru', 'https://gamma-dev.ru/', 'operator', 'confirmed', 'oper3', now())`,
      [gamma],
    );
    expect(await syncCompanySiteSources()).toBe(1);
    expect(await syncCompanySiteSources()).toBe(0);
    const row = (await pool().query<{ source_id: number }>('SELECT source_id FROM company_site_candidates WHERE company_id = $1', [gamma])).rows[0]!;
    expect(await sourceRow(row.source_id)).toMatchObject({ key: 'site:gamma-dev.ru', status: 'active', policy_basis: 'Сайт компании подтверждён оператором oper3' });
  });
});
