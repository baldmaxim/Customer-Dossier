// Этап 05B на PostgreSQL: TC-047…TC-051 — web-preview с курсором и разрывом, форвард-бот
// с журналом обработанных обновлений, правки, пересылки, допуск во время прохода.
// Сеть подменена: web-preview — внедрённым транспортом safeFetch, Bot API — setBotApiForTests.
// Каналы, сообщения и пользователи синтетические.

import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool } from '../../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../../__tests__/integration/db.js';
import type { SafeTransport } from '../../net/safeFetch.js';
import { ingestTelegramSource } from '../scheduler.js';
import { getSourceById, getSourceByKey, setSourceConfig, setSourceHistoryDays, updateCursor, updateSourcePolicy } from '../sources.js';
import { pollBotUpdates, setBotApiForTests } from '../telegramBot.js';
import { setTelegramTransportForTests } from '../telegramWeb.js';

const pool = () => getPool();

// --- web-preview: страницы по адресу -----------------------------------------------------

type PageRoute = () => Promise<{ status: number; body: string }> | { status: number; body: string };
let pages = new Map<string, PageRoute>();
const requested: string[] = [];

const transport: SafeTransport = async url => {
  requested.push(url.toString());
  const route = pages.get(url.toString());
  const res = route ? await route() : { status: 404, body: 'not found' };
  return { status: res.status, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(res.body, 'utf8') };
};

const LONG = 'Подробности сообщения о ходе строительства объекта. ';

const post = (channel: string, id: number, text = `${LONG}Пост номер ${id}.`, extra = ''): string =>
  `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="${channel}/${id}"><div class="tgme_widget_message_bubble">${extra}
   <div class="tgme_widget_message_text">${text}</div>
   <div class="tgme_widget_message_footer"><a class="tgme_widget_message_date"><time datetime="2026-09-10T10:00:00+00:00"></time></a></div></div></div></div>`;

const channelPage = (channel: string, ids: number[], render: (id: number) => string = id => post(channel, id)): string =>
  `<html><body><section class="tgme_channel_history">${ids.map(render).join('')}</section></body></html>`;

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const channelSource = async (key: string, config: Record<string, unknown> = {}) => {
  const id = await insertSyntheticSource({ kind: 'telegram', key, access: 'approved' });
  await setSourceConfig(id, { delayMs: 0, ...config });
  return id;
};

const run = async (id: number) => ingestTelegramSource((await getSourceById(id))!);

const lastRun = async (sourceId: number) =>
  (
    await pool().query<{ outcome: string; items_saved: number; items_changed: number; items_skipped: number; coverage: Record<string, any> }>(
      'SELECT outcome, items_saved, items_changed, items_skipped, coverage FROM source_runs WHERE source_id = $1 ORDER BY id DESC LIMIT 1',
      [sourceId],
    )
  ).rows[0]!;

const sourceState = async (id: number) =>
  (await pool().query<{ health: string; fail_streak: number; cursor: Record<string, any>; status: string }>('SELECT health, fail_streak, cursor, status FROM sources WHERE id = $1', [id])).rows[0]!;

const postIds = async (sourceId: number): Promise<number[]> =>
  (
    await pool().query<{ id: string }>(`SELECT split_part(external_id, '/', 2) AS id FROM source_items WHERE source_id = $1`, [sourceId])
  ).rows
    .map(r => Number(r.id))
    .sort((a, b) => a - b);

// --- Bot API --------------------------------------------------------------------------------

interface IBotCall {
  method: string;
  payload: Record<string, unknown>;
}
const botCalls: IBotCall[] = [];
let pendingUpdates: unknown[] = [];
let onGetUpdates: (() => Promise<void>) | null = null;

const fakeBotApi = async <T>(method: string, payload: Record<string, unknown>): Promise<T> => {
  botCalls.push({ method, payload });
  if (method === 'getUpdates') {
    if (onGetUpdates) await onGetUpdates();
    return pendingUpdates as T;
  }
  return true as T;
};

const OPERATOR = 7001;
const allowed = new Set([OPERATOR]);
const message = (updateId: number, fields: Record<string, unknown>) => ({
  update_id: updateId,
  message: { message_id: updateId, chat: { id: 555, type: 'private' }, from: { id: OPERATOR }, date: 1_789_500_000, ...fields },
});

let botSourceId = 0;

beforeAll(async () => {
  await resetAndMigrate();
  setTelegramTransportForTests(transport);
  setBotApiForTests(fakeBotApi);
  const bot = await getSourceByKey('manual', 'bot');
  botSourceId = bot!.id;
  await updateSourcePolicy(
    botSourceId,
    { accessStatus: 'approved', aiProcessingStatus: 'unknown', scope: 'тест', basis: 'синтетический тест', reference: null, owner: 'test-suite', expiresAt: null },
    'test',
  );
});

afterEach(() => {
  pages = new Map();
  requested.length = 0;
  botCalls.length = 0;
  pendingUpdates = [];
  onGetUpdates = null;
});

afterAll(async () => {
  setTelegramTransportForTests(undefined);
  setBotApiForTests(undefined);
  await closeDb();
});

// ---------------------------------------------------------------------------

describe('web-preview: курсор, разрыв и покрытие (TC-047, TC-051)', () => {
  it('первый запуск не собирает историю: граница истории в покрытии', async () => {
    const id = await channelSource('synthetic_first');
    pages.set('https://t.me/s/synthetic_first', () => ({ status: 200, body: channelPage('synthetic_first', [40, 41, 43]) }));
    await run(id);
    expect(await postIds(id)).toEqual([40, 41, 43]);
    const r = await lastRun(id);
    expect(r.outcome).toBe('ok');
    expect(r.coverage).toMatchObject({ stopReason: 'history_not_collected', historyBefore: 40, missingIdsUnexplained: 1 });
    expect((await sourceState(id)).cursor.tg).toMatchObject({ lastPostId: 43, historyBefore: 40 });
    expect(requested).toEqual(['https://t.me/s/synthetic_first']);
  });

  it('первая страница не покрывает разрыв: он записан и догружается ограниченно, без дублей', async () => {
    const id = await channelSource('synthetic_gap', { maxPagesPerRun: 1 });
    await updateCursor(id, { tg: { lastPostId: 100, lastRecheckAt: null } });
    pages.set('https://t.me/s/synthetic_gap', () => ({ status: 200, body: channelPage('synthetic_gap', range(150, 160)) }));
    pages.set('https://t.me/s/synthetic_gap?before=150', () => ({ status: 200, body: channelPage('synthetic_gap', range(130, 149)) }));
    pages.set('https://t.me/s/synthetic_gap?before=130', () => ({ status: 200, body: channelPage('synthetic_gap', range(95, 129)) }));

    await run(id);
    expect(await lastRun(id)).toMatchObject({ outcome: 'ok', items_saved: 11 });
    expect((await lastRun(id)).coverage).toMatchObject({ stopReason: 'gap_open_max_pages', gap: { after: 100, before: 150 } });
    expect((await sourceState(id)).cursor.tg).toMatchObject({ lastPostId: 160, gap: { after: 100, before: 150 } });

    await setSourceConfig(id, { delayMs: 0, maxPagesPerRun: 3, recheckIntervalSec: 86_400 });
    await run(id);
    expect(await postIds(id)).toEqual(range(101, 160));
    expect((await sourceState(id)).cursor.tg.gap).toBeNull();
    expect((await lastRun(id)).coverage.stopReason).toBe('gap_closed');

    // Повторный проход тех же страниц ничего не дублирует.
    await run(id);
    expect(await postIds(id)).toEqual(range(101, 160));
  });

  it('сбой страницы разрыва: сохранённое остаётся, курсор разрыва не сдвинут', async () => {
    const id = await channelSource('synthetic_fail', { maxPagesPerRun: 3 });
    await updateCursor(id, { tg: { lastPostId: 10, lastRecheckAt: null } });
    pages.set('https://t.me/s/synthetic_fail', () => ({ status: 200, body: channelPage('synthetic_fail', range(30, 35)) }));
    pages.set('https://t.me/s/synthetic_fail?before=30', () => ({ status: 500, body: 'упало' }));
    await run(id);
    expect(await lastRun(id)).toMatchObject({ outcome: 'partial', items_saved: 6 });
    expect((await sourceState(id)).cursor.tg).toMatchObject({ lastPostId: 35, gap: { after: 10, before: 30 } });
    expect((await sourceState(id)).health).toBe('error');
  });

  it('TC-077: инъекция ошибки записи курсора — публикации страницы откатываются вместе с курсором, повтор после снятия отказа догружает', async () => {
    // Контролируемая инъекция на тестовой базе (триггер только для этого источника), а не заполнение диска:
    // проверяется, что публикации и курсор не расходятся при сбое записи.
    const id = await channelSource('synthetic_write_fail');
    await updateCursor(id, { tg: { lastPostId: 40, lastRecheckAt: null } });
    pages.set('https://t.me/s/synthetic_write_fail', () => ({ status: 200, body: channelPage('synthetic_write_fail', range(41, 43)) }));
    await pool().query(`
      CREATE OR REPLACE FUNCTION tg_test_fail_cursor_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'инъекция: ошибка записи курсора'; END $$`);
    await pool().query(
      `CREATE TRIGGER tg_test_fail_cursor_write BEFORE UPDATE ON sources FOR EACH ROW
       WHEN (NEW.id = ${Number(id)} AND NEW.cursor IS DISTINCT FROM OLD.cursor) EXECUTE FUNCTION tg_test_fail_cursor_write()`,
    );
    try {
      await run(id).catch(() => undefined);
      expect(await postIds(id)).toEqual([]);
      expect((await sourceState(id)).cursor.tg).toMatchObject({ lastPostId: 40 });
    } finally {
      await pool().query('DROP TRIGGER IF EXISTS tg_test_fail_cursor_write ON sources');
      await pool().query('DROP FUNCTION IF EXISTS tg_test_fail_cursor_write()');
    }
    await run(id);
    expect(await postIds(id)).toEqual([41, 42, 43]);
    expect((await sourceState(id)).cursor.tg).toMatchObject({ lastPostId: 43 });
  });

  it('отзыв допуска во время прохода: страница не записана, курсор не сдвинут, не ошибка для повторов', async () => {
    const id = await channelSource('synthetic_revoke', { maxPagesPerRun: 3 });
    await updateCursor(id, { tg: { lastPostId: 1, lastRecheckAt: null } });
    pages.set('https://t.me/s/synthetic_revoke', async () => {
      await pool().query(`UPDATE sources SET access_status = 'revoked' WHERE id = $1`, [id]);
      return { status: 200, body: channelPage('synthetic_revoke', range(20, 22)) };
    });
    await run(id);
    expect(await lastRun(id)).toMatchObject({ outcome: 'policy_blocked', items_saved: 0 });
    expect(await postIds(id)).toEqual([]);
    const state = await sourceState(id);
    expect(state).toMatchObject({ health: 'blocked', fail_streak: 0 });
    expect(state.cursor.tg ?? { lastPostId: 1 }).toMatchObject({ lastPostId: 1 });
  });

  it('канал в data-post не совпал с источником — неопределённость идентичности, запись не ведётся', async () => {
    const id = await channelSource('synthetic_renamed');
    pages.set('https://t.me/s/synthetic_renamed', () => ({ status: 200, body: channelPage('other_owner_chan', [5, 6]) }));
    await run(id);
    expect(await lastRun(id)).toMatchObject({ outcome: 'identity_changed' });
    expect((await sourceState(id)).health).toBe('identity_uncertain');
    expect(await postIds(id)).toEqual([]);
  });
});

// --- Этап 22: глубина истории и имя канала ------------------------------------------------

const DAY = 86_400_000;
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY).toISOString();

/** Пост с датой «n дней назад»: граница истории считается от текущего времени. */
const datedPost = (channel: string, id: number, ageDays: number): string =>
  `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="${channel}/${id}"><div class="tgme_widget_message_bubble">
   <div class="tgme_widget_message_text">${LONG}Пост номер ${id}.</div>
   <div class="tgme_widget_message_footer"><a class="tgme_widget_message_date"><time datetime="${daysAgo(ageDays)}"></time></a></div></div></div></div>`;

const datedPage = (channel: string, posts: Array<[number, number]>, head = ''): string =>
  `<html><head>${head}</head><body><section class="tgme_channel_history">${posts.map(([id, age]) => datedPost(channel, id, age)).join('')}</section></body></html>`;

describe('web-preview: глубина истории по дате (этап 22)', () => {
  it('догружает историю назад до границы, старше неё не сохраняет, повторно не листает', async () => {
    const key = 'synthetic_depth';
    const id = await channelSource(key);
    await setSourceHistoryDays(id, 30);
    pages.set(`https://t.me/s/${key}`, () => ({ status: 200, body: datedPage(key, range(100, 110).map(n => [n, 1])) }));
    pages.set(`https://t.me/s/${key}?before=100`, () => ({ status: 200, body: datedPage(key, range(80, 99).map(n => [n, 10])) }));
    pages.set(`https://t.me/s/${key}?before=80`, () => ({
      status: 200,
      body: datedPage(key, [...range(60, 69).map((n): [number, number] => [n, 40]), ...range(70, 79).map((n): [number, number] => [n, 20])]),
    }));

    await run(id);

    expect(await postIds(id)).toEqual(range(70, 110));
    const state = await sourceState(id);
    expect(state.cursor.tg.historyBefore).toBe(70);
    expect(state.cursor.tg.historyCoveredTo).toBeTruthy();
    expect((await lastRun(id)).coverage.stopReason).toBe('history_depth_reached');

    // Следующий проход: граница уже пройдена — только первая страница, архив не листается.
    requested.length = 0;
    await run(id);
    expect(requested).toEqual([`https://t.me/s/${key}`]);
  });

  it('увеличенная глубина догружается с того же места до начала канала', async () => {
    const key = 'synthetic_deeper';
    const id = await channelSource(key);
    await setSourceHistoryDays(id, 30);
    pages.set(`https://t.me/s/${key}`, () => ({ status: 200, body: datedPage(key, range(20, 25).map(n => [n, 1])) }));
    pages.set(`https://t.me/s/${key}?before=20`, () => ({
      status: 200,
      body: datedPage(key, [...range(10, 14).map((n): [number, number] => [n, 50]), ...range(15, 19).map((n): [number, number] => [n, 5])]),
    }));
    await run(id);
    expect(await postIds(id)).toEqual(range(15, 25));

    await setSourceHistoryDays(id, 90);
    pages.set(`https://t.me/s/${key}?before=15`, () => ({ status: 200, body: datedPage(key, range(10, 14).map(n => [n, 50])) }));
    pages.set(`https://t.me/s/${key}?before=10`, () => ({ status: 200, body: datedPage(key, []) }));
    await run(id);

    expect(await postIds(id)).toEqual(range(10, 25));
    expect((await sourceState(id)).cursor.tg.historyComplete).toBe(true);
    expect((await lastRun(id)).coverage.stopReason).toBe('channel_start_reached');
  });

  it('без глубины первый запуск историю по-прежнему не собирает', async () => {
    const key = 'synthetic_nodepth';
    const id = await channelSource(key);
    pages.set(`https://t.me/s/${key}`, () => ({ status: 200, body: datedPage(key, range(5, 9).map(n => [n, 1])) }));
    await run(id);
    expect(requested).toEqual([`https://t.me/s/${key}`]);
    expect(await postIds(id)).toEqual(range(5, 9));
  });
});

describe('web-preview: имя канала (этап 22)', () => {
  it('имя со страницы канала заменяет ключ, но не перетирает название оператора', async () => {
    const key = 'synthetic_named';
    const id = await channelSource(key);
    const head = '<meta property="og:title" content="Демо: стройка изнутри">';
    pages.set(`https://t.me/s/${key}`, () => ({ status: 200, body: datedPage(key, [[1, 1]], head) }));

    await run(id);
    expect((await getSourceById(id))!.title).toBe('Демо: стройка изнутри');

    await pool().query(`UPDATE sources SET title = 'Название оператора' WHERE id = $1`, [id]);
    await run(id);
    expect((await getSourceById(id))!.title).toBe('Название оператора');
  });

  it('имя чужого канала (identity_changed) в источник не пишется', async () => {
    const key = 'synthetic_named_foreign';
    const id = await channelSource(key);
    pages.set(`https://t.me/s/${key}`, () => ({
      status: 200,
      body: datedPage('someone_else', [[3, 1]], '<meta property="og:title" content="Чужой канал">'),
    }));
    await run(id);
    expect((await getSourceById(id))!.title).toBe(key);
  });
});

describe('web-preview: правки, короткое опровержение, одинаковый текст, пересылка без источника (TC-049)', () => {
  it('правка в окне перепроверки и короткое опровержение сохраняются новой редакцией', async () => {
    const id = await channelSource('synthetic_edit', { recheckIntervalSec: 0 });
    pages.set('https://t.me/s/synthetic_edit', () => ({ status: 200, body: channelPage('synthetic_edit', [200]) }));
    await run(id);
    pages.set('https://t.me/s/synthetic_edit', () => ({
      status: 200,
      body: channelPage('synthetic_edit', [200], i =>
        post('synthetic_edit', i, 'Опровержение: не срывали.', '<span class="tgme_widget_message_meta">edited</span>'),
      ),
    }));
    await run(id);
    expect(await lastRun(id)).toMatchObject({ items_changed: 1 });
    const revisions = await pool().query<{ revision_no: number; body: string }>(
      `SELECT r.revision_no, r.body FROM document_revisions r JOIN source_items i ON i.id = r.source_item_id WHERE i.source_id = $1 ORDER BY r.revision_no`,
      [id],
    );
    expect(revisions.rows.map(r => r.revision_no)).toEqual([1, 2]);
    expect(revisions.rows[1]!.body).toBe('Опровержение: не срывали.');
    const meta = await pool().query<{ transport_meta: Record<string, unknown> }>(
      `SELECT o.transport_meta FROM source_observations o WHERE o.source_id = $1 ORDER BY o.id DESC LIMIT 1`,
      [id],
    );
    expect(meta.rows[0]!.transport_meta).toMatchObject({ transport: 'telegram_web_preview', edited: true, editDate: null, postId: 200 });
  });

  it('одинаковый текст в двух каналах — две публикации; пересылка без ссылки — источник не выдуман', async () => {
    const text = `${LONG}Общая новость для двух каналов.`;
    const a = await channelSource('synthetic_same_a');
    const b = await channelSource('synthetic_same_b');
    pages.set('https://t.me/s/synthetic_same_a', () => ({ status: 200, body: channelPage('synthetic_same_a', [1], i => post('synthetic_same_a', i, text)) }));
    pages.set('https://t.me/s/synthetic_same_b', () => ({
      status: 200,
      body: channelPage('synthetic_same_b', [9], i =>
        post('synthetic_same_b', i, text, '<div class="tgme_widget_message_forwarded_from">Forwarded from <span class="tgme_widget_message_forwarded_from_name">Скрытый</span></div>'),
      ),
    }));
    await run(a);
    await run(b);
    expect(await postIds(a)).toEqual([1]);
    expect(await postIds(b)).toEqual([9]);
    const obs = await pool().query<{ forward_origin: string | null; transport_meta: Record<string, any> }>(
      'SELECT forward_origin, transport_meta FROM source_observations WHERE source_id = $1',
      [b],
    );
    expect(obs.rows[0]!.forward_origin).toBeNull();
    expect(obs.rows[0]!.transport_meta.forwardOrigin).toEqual({ name: 'Скрытый', username: null, messageId: null });
  });
});

// ---------------------------------------------------------------------------

describe('форвард-бот: журнал обновлений, повтор, правка, пересылки (TC-048…TC-050)', () => {
  const botItems = async (): Promise<number> =>
    (await pool().query<{ n: number }>('SELECT count(*)::int AS n FROM source_items WHERE source_id = $1', [botSourceId])).rows[0]!.n;

  it('повтор обновления после перезапуска не дублирует; offset берётся из журнала', async () => {
    pendingUpdates = [message(1001, { text: `${LONG}Пересланное сообщение один.` })];
    const first = await pollBotUpdates({ timeoutSec: 0, allowedUserIds: allowed });
    expect(first).toMatchObject({ processed: 1, accepted: 1, replayed: 0 });
    const items = await botItems();

    // Telegram повторил то же обновление (подтверждение offset не дошло) — перезапуск long polling.
    setBotApiForTests(fakeBotApi);
    const replay = await pollBotUpdates({ timeoutSec: 0, allowedUserIds: allowed });
    expect(replay).toMatchObject({ processed: 0, replayed: 1 });
    expect(await botItems()).toBe(items);
    const offsets = botCalls.filter(c => c.method === 'getUpdates').map(c => c.payload.offset);
    expect(offsets[offsets.length - 1]).toBe(1002);
    expect(botCalls.filter(c => c.method === 'sendMessage')).toHaveLength(1);
  });

  it('сбой посреди пачки: зафиксированное остаётся, несохранённое обновление обрабатывается при повторе', async () => {
    // Второе обновление падает при записи в журнал (номер чата вне диапазона bigint) — его транзакция откатывается целиком.
    pendingUpdates = [
      message(1002, { text: `${LONG}Сообщение до сбоя.` }),
      { update_id: 1003, message: { message_id: 3, chat: { id: 1e20, type: 'private' }, from: { id: OPERATOR }, date: 1_789_500_000, text: `${LONG}Сообщение со сбоем.` } },
    ];
    await expect(pollBotUpdates({ timeoutSec: 0, allowedUserIds: allowed })).rejects.toThrow();
    const recorded = await pool().query<{ update_id: number }>('SELECT update_id FROM bot_processed_updates WHERE update_id >= 1002 ORDER BY update_id');
    expect(recorded.rows.map(r => r.update_id)).toEqual([1002]);

    pendingUpdates = [message(1002, { text: `${LONG}Сообщение до сбоя.` }), message(1003, { text: `${LONG}Сообщение после восстановления.` })];
    const retry = await pollBotUpdates({ timeoutSec: 0, allowedUserIds: allowed });
    expect(retry).toMatchObject({ replayed: 1, processed: 1, accepted: 1 });
  });

  it('правка сообщения — новая редакция с датой правки; короткая правка не отбрасывается; ответа на правку нет', async () => {
    pendingUpdates = [
      { update_id: 1004, edited_message: { message_id: 1001, chat: { id: 555, type: 'private' }, from: { id: OPERATOR }, date: 1_789_500_000, edit_date: 1_789_600_000, text: 'Исправлено: не так.' } },
    ];
    const result = await pollBotUpdates({ timeoutSec: 0, allowedUserIds: allowed });
    expect(result).toMatchObject({ processed: 1, accepted: 1 });
    const rev = await pool().query<{ revision_no: number; source_modified_at: Date }>(
      `SELECT r.revision_no, r.source_modified_at FROM document_revisions r JOIN source_items i ON i.id = r.source_item_id
       WHERE i.source_id = $1 AND i.item_key = 'ext:555/1001' ORDER BY r.revision_no DESC LIMIT 1`,
      [botSourceId],
    );
    expect(rev.rows[0]!.revision_no).toBe(2);
    expect(rev.rows[0]!.source_modified_at.getTime()).toBe(1_789_600_000 * 1000);
    expect(botCalls.filter(c => c.method === 'sendMessage')).toHaveLength(0);
  });

  it('пересылка со скрытым автором: канал не выдуман, дата — исходного поста; подпись без вложения — не full', async () => {
    pendingUpdates = [
      message(1005, { text: `${LONG}Пересылка от скрытого автора.`, forward_origin: { type: 'hidden_user', sender_user_name: 'Иван', date: 1_789_000_000 } }),
      message(1006, { caption: `${LONG}Подпись без вложения.` }),
    ];
    await pollBotUpdates({ timeoutSec: 0, allowedUserIds: allowed });
    const rows = await pool().query<{ item_key: string; forward_origin: string | null; transport_meta: Record<string, any>; published_at: Date | null; completeness: string }>(
      `SELECT i.item_key, o.forward_origin, o.transport_meta, r.published_at, r.completeness::text AS completeness
       FROM source_observations o JOIN source_items i ON i.id = o.source_item_id JOIN document_revisions r ON r.id = o.revision_id
       WHERE i.item_key IN ('ext:555/1005', 'ext:555/1006') ORDER BY i.item_key`,
    );
    const hidden = rows.rows.find(r => r.item_key === 'ext:555/1005')!;
    expect(hidden.forward_origin).toBeNull();
    expect(hidden.transport_meta.forwardOrigin).toMatchObject({ type: 'hidden_user', senderName: 'Иван', chatId: null, username: null });
    expect(hidden.transport_meta.forwardedByUserId).toBe(OPERATOR);
    expect(hidden.published_at!.getTime()).toBe(1_789_000_000 * 1000);
    expect(rows.rows.find(r => r.item_key === 'ext:555/1006')!.completeness).toBe('unknown');
  });

  it('пустой белый список — никто не принимается, обновление отмечено, содержимое не хранится', async () => {
    const before = await botItems();
    pendingUpdates = [message(1007, { text: `${LONG}Сообщение при пустом списке.` })];
    const result = await pollBotUpdates({ timeoutSec: 0, allowedUserIds: new Set() });
    expect(result).toMatchObject({ rejected: 1, accepted: 0 });
    expect(await botItems()).toBe(before);
    const row = await pool().query<{ outcome: string }>('SELECT outcome FROM bot_processed_updates WHERE update_id = 1007');
    expect(row.rows[0]!.outcome).toBe('rejected_sender');
  });

  it('пропуск номеров обновлений виден; отзыв допуска во время long polling останавливает приём без отметки', async () => {
    pendingUpdates = [message(1012, { text: `${LONG}Сообщение после пропуска.` })];
    const gap = await pollBotUpdates({ timeoutSec: 0, allowedUserIds: allowed });
    expect(gap.possibleGap).toEqual({ from: 1008, to: 1011 });

    const before = await botItems();
    pendingUpdates = [message(1013, { text: `${LONG}Сообщение во время отзыва.` })];
    onGetUpdates = async () => {
      await pool().query(`UPDATE sources SET access_status = 'revoked' WHERE id = $1`, [botSourceId]);
    };
    const revoked = await pollBotUpdates({ timeoutSec: 0, allowedUserIds: allowed });
    expect(revoked.stoppedByPolicy).toContain('отозвано');
    expect(await botItems()).toBe(before);
    expect((await pool().query('SELECT 1 FROM bot_processed_updates WHERE update_id = 1013')).rowCount).toBe(0);
  });
});
