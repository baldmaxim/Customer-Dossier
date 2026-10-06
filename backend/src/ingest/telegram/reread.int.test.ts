// Перечитывание истории канала исправленным разборщиком (06.10.2026) на PostgreSQL: ответ, сохранённый цитатой,
// получает новую редакцию со своим текстом; неизменный пост — только наблюдение; чужой (не собранный) пост не пишется;
// без допуска к сбору запросов нет. Транспорт подменён — сети нет.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../../__tests__/integration/db.js';
import { getSourceById } from '../sources.js';
import { storeDocument } from '../store.js';
import { rereadTelegramHistory } from './reread.js';

const CHANNEL = 'reread_demo';
const QUOTE = 'Вот и начали распродаваться активы KR Properties в лапы страждущих и жаждущих. Проект «Столярный»…';
const OWN = 'October Group продолжает перекраивать доставшийся от KR Properties проект в Столярном переулке: новая концепция.';
const PLAIN = 'Наконец-то согласовал архитектуру на свой участок «Нижняя Масловка, 17»: жилой дом на 35 тысяч метров.';

const post = (id: number, inner: string): string =>
  `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="${CHANNEL}/${id}">${inner}
   <div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/${CHANNEL}/${id}"><time datetime="2026-10-06T08:00:00+00:00"></time></a></div>
   </div></div>`;

const PAGE = [
  post(10, `<a class="tgme_widget_message_reply" href="https://t.me/${CHANNEL}/5"><div class="tgme_widget_message_text js-message_reply_text">${QUOTE}</div></a>
            <div class="tgme_widget_message_text js-message_text">${OWN}</div>`),
  post(11, `<div class="tgme_widget_message_text js-message_text">${PLAIN}</div>`),
  post(12, `<div class="tgme_widget_message_text js-message_text">Пост, которого портал не собирал: история не расширяется перечитыванием.</div>`),
].join('\n');

let sourceId = 0;
const fetched: Array<number | undefined> = [];
const fetchPage = async (_channel: string, before: number | undefined) => {
  fetched.push(before);
  return { html: before === undefined ? PAGE : '' };
};

const store = (id: number, body: string) =>
  storeDocument({
    sourceId,
    sourceRunId: null,
    externalId: `${CHANNEL}/${id}`,
    url: `https://t.me/${CHANNEL}/${id}`,
    title: null,
    body,
    publishedAt: new Date('2026-10-06T08:00:00Z'),
    forwardFrom: null,
    fetchedAt: new Date(Date.now() - 60_000),
  });

const revisions = async (id: number) =>
  (
    await getPool().query<{ body: string; latest: boolean }>(
      `SELECT r.body, r.id = si.latest_revision_id AS latest FROM document_revisions r JOIN source_items si ON si.id = r.source_item_id
       WHERE si.source_id = $1 AND si.item_key = $2 ORDER BY r.revision_no`,
      [sourceId, `ext:${CHANNEL}/${id}`],
    )
  ).rows;

beforeAll(async () => {
  await resetAndMigrate();
  sourceId = await insertSyntheticSource({ kind: 'telegram', key: CHANNEL, status: 'paused', access: 'approved' });
  await store(10, QUOTE); // старый разборщик: цитата вместо своего текста
  await store(11, PLAIN);
});

afterAll(async () => {
  await closeDb();
});

describe('перечитывание истории канала (tg_web@3)', () => {
  it('без записи — считает, сколько изменится, и ничего не пишет', async () => {
    const report = await rereadTelegramHistory((await getSourceById(sourceId))!, { dryRun: true, maxPages: 5, fetchPage, delayMs: 0 });
    expect(report).toMatchObject({ pages: 1, seen: 2, changed: 1, unchanged: 1, unknown: 1, stoppedBy: 'done', nextBefore: null });
    expect(report.samples).toEqual([{ postId: 10, before: QUOTE.length, after: OWN.length }]);
    expect(await revisions(10)).toHaveLength(1);
  });

  it('с записью — у ответа новая текущая редакция со своим текстом; прочее не тронуто', async () => {
    const report = await rereadTelegramHistory((await getSourceById(sourceId))!, { dryRun: false, maxPages: 5, fetchPage, delayMs: 0 });
    expect(report).toMatchObject({ changed: 1, unchanged: 1, unknown: 1, stoppedBy: 'done' });
    expect(await revisions(10)).toEqual([
      { body: QUOTE, latest: false },
      { body: OWN, latest: true },
    ]);
    expect(await revisions(11)).toHaveLength(1);
    expect(await revisions(12)).toEqual([]);
  });

  it('без допуска к сбору — ни одного запроса', async () => {
    await getPool().query(`UPDATE sources SET access_status = 'revoked' WHERE id = $1`, [sourceId]);
    fetched.length = 0;
    const report = await rereadTelegramHistory((await getSourceById(sourceId))!, { dryRun: false, maxPages: 5, fetchPage, delayMs: 0 });
    expect(report.stoppedBy).toBe('policy');
    expect(fetched).toEqual([]);
  });
});
