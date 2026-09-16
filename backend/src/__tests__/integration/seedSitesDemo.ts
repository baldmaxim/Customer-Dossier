// Синтетические сайты для ручной проверки здоровья источников в админке (этап 05A).
// Только тестовая база. Сеть не используется: страницы отдаёт внедрённый транспорт внутри
// этого процесса, проверки адресов, редиректов и размера остаются в safeFetch.
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-sites
//
// Создаёт три сайта *.test и прогоняет адаптер: список с двумя страницами (ok), сменившаяся
// вёрстка (parser_degraded) и ограничение частоты (rate_limited). Все источники остаются на паузе.

// Общий preflight тестовой цели — до импорта env и пула (src/db/testTargetBootstrap.ts).
const { prepareTestTargetProcess } = await import('../../db/testTargetBootstrap.js');
prepareTestTargetProcess();

const { closeDb, getPool } = await import('../../db/pool.js');
const { assertIsolatedTarget, insertSyntheticSource } = await import('./db.js');
const { ingestWebsiteSource } = await import('../../ingest/scheduler.js');
const { getSourceById, setSourceConfig } = await import('../../ingest/sources.js');
const { setSiteTransportForTests } = await import('../../ingest/sites/fetcher.js');

await assertIsolatedTarget();

const LONG = 'Подробности приводятся в тексте статьи. '.repeat(6);
const pages = new Map<string, { status: number; headers?: Record<string, string>; body: string }>();
const page = (url: string, body: string): void => void pages.set(url, { status: 200, body });

// 1. Нормальный сайт: две страницы списка, статьи, карточка объекта.
page('https://ok-sites-demo.test/news', '<div class="item"><a href="/n1">Первая</a><span class="date">12.09.2026 10:30</span></div><a class="next" href="/news?page=2">дальше</a>');
page('https://ok-sites-demo.test/news?page=2', '<div class="item"><a href="/n2">Вторая</a><span class="date">11 сентября</span></div>');
page('https://ok-sites-demo.test/n1', `<h1>Демо-Гранит начал корпус 2</h1><div class="article-body"><p>Работы начаты.</p><p>${LONG}</p></div>`);
page('https://ok-sites-demo.test/n2', '<h1>Статья без контейнера</h1><article><p>Текст лежит не там, где ждёт профиль.</p></article>');
page('https://ok-sites-demo.test/objects/1', '<h1>ЖК «Демо-Роща»</h1><dl><div><dt>Застройщик</dt><dd>Демо-Гранит</dd></div><div><dt>Статус</dt><dd>строится</dd></div></dl>');
// 2. Сменившаяся вёрстка: большая страница, селектор ничего не находит.
page('https://degraded-sites-demo.test/news', `<html><body>${'<div class="card-new"><a href="/x">Новость</a></div>'.repeat(80)}</body></html>`);
// 3. Ограничение частоты.
pages.set('https://limited-sites-demo.test/news', { status: 429, headers: { 'retry-after': '600' }, body: 'slow down' });

setSiteTransportForTests(async url => {
  const hit = pages.get(url.toString());
  return hit
    ? { status: hit.status, headers: { 'content-type': 'text/html; charset=utf-8', ...(hit.headers ?? {}) }, body: Buffer.from(hit.body) }
    : { status: 404, headers: {}, body: Buffer.from('not found') };
});

const profile = (host: string, extra: Record<string, unknown> = {}) => ({
  mode: 'html_list',
  startUrls: [`https://${host}/news`],
  list: { itemSelector: '.item', linkSelector: 'a', dateSelector: '.date' },
  pagination: { nextSelector: 'a.next', maxPages: 3 },
  article: { bodySelector: '.article-body' },
  limits: { delayMs: 0 },
  ...extra,
});

for (const [host, extra] of [
  [
    'ok-sites-demo.test',
    {
      projectCards: {
        urls: ['https://ok-sites-demo.test/objects/1'],
        nameSelector: 'h1',
        fieldRowSelector: 'dl > div',
        fieldLabelSelector: 'dt',
        fieldValueSelector: 'dd',
      },
    },
  ],
  ['degraded-sites-demo.test', {}],
  ['limited-sites-demo.test', {}],
] as const) {
  const id = await insertSyntheticSource({ kind: 'website', key: host, status: 'paused', access: 'approved', baseUrl: `https://${host}` });
  await setSourceConfig(id, profile(host, extra));
  const report = await ingestWebsiteSource((await getSourceById(id))!);
  console.log(`[seed] ${host} (id ${id}): ${report.ok ? 'ok' : report.error}`);
}

const runs = await getPool().query<{ key: string; outcome: string; items_found: number; items_saved: number; items_failed: number }>(
  `SELECT s.key, r.outcome, r.items_found, r.items_saved, r.items_failed FROM source_runs r JOIN sources s ON s.id = r.source_id
   WHERE s.key LIKE '%-sites-demo.test' ORDER BY r.id`,
);
for (const r of runs.rows) console.log(`[seed] ${r.key}: ${r.outcome}, найдено ${r.items_found}, сохранено ${r.items_saved}, ошибок ${r.items_failed}`);
setSiteTransportForTests(undefined);
await closeDb();
