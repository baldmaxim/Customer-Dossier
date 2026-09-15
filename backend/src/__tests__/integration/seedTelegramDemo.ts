// Синтетические Telegram-источники для ручной проверки курсоров, покрытия и журнала бота (этап 05B).
// Только тестовая база. Сеть не используется: страницы t.me/s/ отдаёт внедрённый транспорт,
// Bot API подменён внутри этого процесса. Токены и реальные каналы не нужны.
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-telegram

process.env.TG_INFO_ORIGINAL_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

const { assertTestDatabaseUrl } = await import('../../db/testTarget.js');
assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.TG_INFO_ORIGINAL_DATABASE_URL);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_SSL = 'false';
process.env.DOTENV_CONFIG_PATH = 'seed-no-dotenv.env';

const { closeDb, getPool } = await import('../../db/pool.js');
const { assertIsolatedTarget, insertSyntheticSource } = await import('./db.js');
const { ingestTelegramSource } = await import('../../ingest/scheduler.js');
const { getSourceById, getSourceByKey, setSourceConfig, updateCursor, updateSourcePolicy } = await import('../../ingest/sources.js');
const { setTelegramTransportForTests } = await import('../../ingest/telegramWeb.js');
const { pollBotUpdates, setBotApiForTests } = await import('../../ingest/telegramBot.js');

await assertIsolatedTarget();

const LONG = 'Подробности сообщения о ходе строительства объекта. ';
const post = (channel: string, id: number): string =>
  `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="${channel}/${id}"><div class="tgme_widget_message_bubble">
   <div class="tgme_widget_message_text">${LONG}Демо-пост ${channel} №${id}.</div>
   <div class="tgme_widget_message_footer"><a class="tgme_widget_message_date"><time datetime="2026-09-10T10:00:00+00:00"></time></a></div></div></div></div>`;
const page = (channel: string, ids: number[]): string => `<html><body>${ids.map(id => post(channel, id)).join('')}</body></html>`;
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const pages = new Map<string, string>([
  ['https://t.me/s/demo_tg_gap', page('demo_tg_gap', range(150, 160))],
  ['https://t.me/s/demo_tg_renamed', page('demo_tg_other', [5, 6])],
]);
setTelegramTransportForTests(async url => {
  const body = pages.get(url.toString());
  return body ? { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(body) } : { status: 404, headers: {}, body: Buffer.from('') };
});

// 1. Канал с разрывом: прошлый проход остановился на №100, первая страница начинается с №150.
const gapId = await insertSyntheticSource({ kind: 'telegram', key: 'demo_tg_gap', status: 'paused', access: 'approved' });
await setSourceConfig(gapId, { delayMs: 0, maxPagesPerRun: 1 });
await updateCursor(gapId, { tg: { lastPostId: 100, lastRecheckAt: null } });
console.log(`[seed] demo_tg_gap: ${(await ingestTelegramSource((await getSourceById(gapId))!)).error ?? 'ok'}`);

// 2. Канал, чья страница отдаёт посты другого канала.
const renamedId = await insertSyntheticSource({ kind: 'telegram', key: 'demo_tg_renamed', status: 'paused', access: 'approved' });
await setSourceConfig(renamedId, { delayMs: 0 });
console.log(`[seed] demo_tg_renamed: ${(await ingestTelegramSource((await getSourceById(renamedId))!)).error ?? 'ok'}`);

// 3. Бот: сообщение, повтор того же обновления, правка и отклонённый отправитель.
const bot = (await getSourceByKey('manual', 'bot'))!;
await updateSourcePolicy(
  bot.id,
  { accessStatus: 'approved', aiProcessingStatus: 'unknown', scope: 'демо', basis: 'синтетическая проверка', reference: null, owner: 'seed', expiresAt: null },
  'seed',
);
const updates = [
  { update_id: 9001, message: { message_id: 1, chat: { id: 900, type: 'private' }, from: { id: 1 }, date: 1_789_500_000, text: `${LONG}Пересланный пост.`, forward_origin: { type: 'hidden_user', sender_user_name: 'Скрытый', date: 1_789_000_000 } } },
  { update_id: 9002, message: { message_id: 2, chat: { id: 901, type: 'private' }, from: { id: 999 }, date: 1_789_500_000, text: `${LONG}Чужой отправитель.` } },
  { update_id: 9003, edited_message: { message_id: 1, chat: { id: 900, type: 'private' }, from: { id: 1 }, date: 1_789_500_000, edit_date: 1_789_600_000, text: 'Поправка: не так.' } },
];
setBotApiForTests(async <T>(method: string): Promise<T> => (method === 'getUpdates' ? (updates as T) : (true as T)));
const first = await pollBotUpdates({ timeoutSec: 0, allowedUserIds: new Set([1]) });
const replay = await pollBotUpdates({ timeoutSec: 0, allowedUserIds: new Set([1]) });
console.log(`[seed] бот: обработано ${first.processed}, принято ${first.accepted}, отклонено ${first.rejected}; повтор: ${replay.replayed} уже обработанных`);

const runs = await getPool().query<{ key: string; outcome: string; stop: string | null }>(
  `SELECT s.key, r.outcome, r.coverage->>'stopReason' AS stop FROM source_runs r JOIN sources s ON s.id = r.source_id WHERE s.key LIKE 'demo_tg_%' ORDER BY r.id`,
);
for (const r of runs.rows) console.log(`[seed] ${r.key}: ${r.outcome}${r.stop ? `, ${r.stop}` : ''}`);

setTelegramTransportForTests(undefined);
setBotApiForTests(undefined);
await closeDb();
