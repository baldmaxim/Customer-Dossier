// Синтетические публикации с несколькими редакциями — для ручной проверки UI
// версий на ТЕСТОВОЙ базе. Та же проверка цели, что у интеграционных тестов:
// рабочую базу этот скрипт тронуть не может.
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-revisions

process.env.TG_INFO_ORIGINAL_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

const { assertTestDatabaseUrl } = await import('../../db/testTarget.js');
assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.TG_INFO_ORIGINAL_DATABASE_URL);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_SSL = 'false';
process.env.DOTENV_CONFIG_PATH = 'seed-no-dotenv.env';

const { closeDb } = await import('../../db/pool.js');
const { assertIsolatedTarget, insertSyntheticSource } = await import('./db.js');
const { storeDocument } = await import('../../ingest/store.js');

await assertIsolatedTarget();

const channel = await insertSyntheticSource({ kind: 'telegram', key: 'demo_revisions_channel', status: 'paused' });
const repost = await insertSyntheticSource({ kind: 'telegram', key: 'demo_revisions_repost', status: 'paused' });

const v1 = 'Демо-Альфа ведёт монтаж ВК корпуса 2 ЖК «Берег-Демо».\nСрок завершения — IV квартал 2026 года.';
const v2 = 'Демо-Альфа ведёт монтаж ВК корпуса 2 ЖК «Берег-Демо».\nСрок завершения перенесён на I квартал 2027 года.\nПричина не указана.';

const first = await storeDocument({
  sourceId: channel,
  sourceRunId: null,
  externalId: 'demo_revisions_channel/1',
  url: 'https://t.me/demo_revisions_channel/1',
  title: null,
  body: v1,
  publishedAt: new Date('2026-09-01T09:00:00Z'),
  forwardFrom: null,
  representation: 'telegram_web_text@1',
  completeness: 'full',
  completenessReason: 'telegram_web_message_text',
  fetchedAt: new Date('2026-09-01T09:05:00Z'),
});
await storeDocument({
  sourceId: channel,
  sourceRunId: null,
  externalId: 'demo_revisions_channel/1',
  url: 'https://t.me/demo_revisions_channel/1',
  title: null,
  body: v2,
  publishedAt: new Date('2026-09-01T09:00:00Z'),
  forwardFrom: null,
  representation: 'telegram_web_text@1',
  completeness: 'full',
  completenessReason: 'telegram_web_message_text',
  fetchedAt: new Date('2026-09-02T09:05:00Z'),
});
await storeDocument({
  sourceId: repost,
  sourceRunId: null,
  externalId: 'demo_revisions_repost/40',
  url: 'https://t.me/demo_revisions_repost/40',
  title: null,
  body: v1,
  publishedAt: new Date('2026-09-01T10:00:00Z'),
  forwardFrom: 'demo_revisions_channel',
  representation: 'telegram_web_text@1',
  completeness: 'caption_only',
  completenessReason: 'telegram_web_media_caption',
  attachments: [{ kind: 'photo', status: 'unsupported' }],
  fetchedAt: new Date('2026-09-01T10:05:00Z'),
});

console.log(`[seed] legacy-документ: ${first.documentId}`);
console.log(`[seed] откройте http://127.0.0.1:5173/documents/${first.documentId}`);
await closeDb();
