// Реализация команд CLI пайплайна: вывод и действия.
//
// Отделено от cli.ts, где остался только разбор аргументов: файл команд
// перерос предел в 500 строк из правил проекта, и дописывать туда новые
// команды значило бы дальше его раздувать.

import { execute, query, queryOne } from '../db/pool.js';
import { env } from '../config/env.js';
import { listPendingMerges } from '../resolve/merge.js';
import { MAX_ATTEMPTS, runPipelinePass } from './worker.js';

export const printPass = (results: Awaited<ReturnType<typeof runPipelinePass>>): number => {
  if (results.length === 0) {
    console.log('[pipeline] очередь пуста');
    return 0;
  }
  const totals = { extracted: 0, skipped: 0, failed: 0 };
  for (const r of results) totals[r.status] += 1;

  const applied = results.reduce(
    (acc, r) => {
      if (!r.stats) return acc;
      acc.companies += r.stats.companies;
      acc.projects += r.stats.projects;
      acc.mentions += r.stats.mentions;
      acc.participants += r.stats.participants;
      acc.events += r.stats.events;
      acc.queued += r.stats.queuedMerges;
      return acc;
    },
    { companies: 0, projects: 0, mentions: 0, participants: 0, events: 0, queued: 0 },
  );

  console.log(
    `[pipeline] обработано ${results.length}: извлечено ${totals.extracted}, ` +
      `пропущено ${totals.skipped}, ошибок ${totals.failed}`,
  );
  console.log(
    `[pipeline] в канон: компаний ${applied.companies}, объектов ${applied.projects}, ` +
      `упоминаний ${applied.mentions}, ролей ${applied.participants}, событий ${applied.events}`,
  );
  if (applied.queued > 0) {
    console.log(`[pipeline] на ручное слияние отправлено пар: ${applied.queued}`);
  }
  for (const r of results.filter(r => r.status === 'failed')) {
    console.error(`[pipeline] док ${r.documentId}: ${r.error}`);
  }
  return totals.extracted;
};

export const showStats = async (): Promise<void> => {
  const q = await queryOne<{
    new_docs: number;
    extracting: number;
    extracted: number;
    failed: number;
    skipped: number;
    stuck: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('new','queued'))::int AS new_docs,
       count(*) FILTER (WHERE status = 'extracting')::int      AS extracting,
       count(*) FILTER (WHERE status = 'extracted')::int       AS extracted,
       count(*) FILTER (WHERE status = 'failed')::int          AS failed,
       count(*) FILTER (WHERE status = 'skipped')::int         AS skipped,
       count(*) FILTER (WHERE status IN ('new','queued') AND attempts >= $1)::int AS stuck
     FROM raw_documents`,
    [MAX_ATTEMPTS],
  );
  console.log('[pipeline] очередь:');
  console.log(`  ожидают:    ${q?.new_docs ?? 0}`);
  console.log(`  в работе:   ${q?.extracting ?? 0}`);
  console.log(`  извлечены:  ${q?.extracted ?? 0}`);
  console.log(`  нерелевант: ${q?.skipped ?? 0}`);
  console.log(`  ошибки:     ${q?.failed ?? 0}`);
  // Документ, исчерпавший попытки, остаётся в статусе queued и в строке
  // «ожидают» выглядит нормально — а на деле воркер его больше не возьмёт.
  if ((q?.stuck ?? 0) > 0) {
    console.log(`  ЗАСТРЯЛИ:   ${q?.stuck} (попытки исчерпаны, лечится --retry)`);
  }

  const e = await queryOne<{ total: number; bad: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status <> 'ok')::int AS bad
     FROM extractions WHERE prompt_version = $1`,
    [env.PROMPT_VERSION],
  );
  const total = e?.total ?? 0;
  const bad = e?.bad ?? 0;
  const rate = total === 0 ? 0 : (bad / total) * 100;
  console.log(
    `[pipeline] версия промпта ${env.PROMPT_VERSION}: вызовов ${total}, ` +
      `неудачных ${bad} (${rate.toFixed(1)} %, цель M2 < 2 %)`,
  );

  const byFailure = await query<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM extractions
     WHERE status <> 'ok' AND prompt_version = $1
     GROUP BY status ORDER BY n DESC`,
    [env.PROMPT_VERSION],
  );
  for (const row of byFailure) console.log(`  ${row.status}: ${row.n}`);
};

/** Последние отказы с текстом ошибки — первое, что смотрят, когда «не работает». */
export const showErrors = async (limit = 15): Promise<void> => {
  const rows = await query<{
    documentId: number;
    status: string;
    createdAt: string;
    message: string | null;
    bodyLen: number;
  }>(
    `SELECT e.document_id AS "documentId", e.status::text AS status,
            e.created_at  AS "createdAt",
            left(e.raw_response, 400) AS message,
            d.body_len    AS "bodyLen"
     FROM extractions e
     JOIN raw_documents d ON d.id = e.document_id
     WHERE e.status <> 'ok'
     ORDER BY e.created_at DESC
     LIMIT $1`,
    [limit],
  );

  if (rows.length === 0) {
    console.log('[errors] отказов нет');
    return;
  }

  console.log(`[errors] последние ${rows.length}:`);
  for (const r of rows) {
    console.log(`\n  док ${r.documentId} · ${r.status} · текст ${r.bodyLen} симв.`);
    console.log(`  ${r.message ?? 'сообщение не сохранено'}`);
  }

  console.log(
    '\nПодсказки:\n' +
      '  "context" / "token" в тексте — в LM Studio мал контекст. Нужно 8192.\n' +
      '  "aborted" / "timeout"        — модель не успевает. Поднимите LMSTUDIO_TIMEOUT_MS\n' +
      '                                 или возьмите модель меньше (Qwen3-4B).\n' +
      '  "fetch failed" / ECONNREFUSED — сервер LM Studio не запущен (Developer -> Start Server).\n' +
      '  "model" / "not found"         — LMSTUDIO_MODEL не совпадает с загруженной моделью.',
  );
};

/**
 * Вернуть провалившиеся документы в очередь.
 *
 * Нужно после починки причины сбоя: воркер берёт только 'new' и 'queued',
 * так что документ со статусом 'failed' сам по себе больше не обработается
 * никогда. Счётчик попыток сбрасываем — иначе упрётся в лимит на первом же
 * проходе.
 */
export const retryFailed = async (): Promise<void> => {
  const affected = await execute(
    `UPDATE raw_documents
     SET status = 'queued', attempts = 0, last_error = NULL, updated_at = now()
     WHERE status = 'failed'
        OR (status IN ('new','queued') AND attempts >= $1)`,
    [MAX_ATTEMPTS],
  );
  console.log(`[pipeline] возвращено в очередь: ${affected}`);
  if (affected > 0) {
    console.log('[pipeline] запустите: npm run pipeline:once -- --loop');
  }
};

/**
 * Тексты, которые модель признала не относящимися к делу.
 *
 * Смотреть обязательно: doc_relevant=false — единственное решение модели,
 * которое не оставляет за собой никаких следов в канонe. Если она
 * перестраховывается, портал молча теряет данные, и заметить это можно
 * только глазами.
 */
export const showSkipped = async (limit = 10, sourceKey: string | null = null): Promise<void> => {
  // Фильтр по источнику нужен не для удобства. Нерелевантное из московского
  // канала про мусоропроводы — норма; нерелевантное из «Строительной газеты»,
  // которая целиком про стройку, — почти наверняка ошибка модели.
  const rows = await query<{
    id: number;
    body: string;
    sourceTitle: string;
    publishedAt: string | null;
    url: string | null;
  }>(
    `SELECT d.id, d.body, d.url, d.published_at AS "publishedAt", s.title AS "sourceTitle"
     FROM raw_documents d
     JOIN sources s ON s.id = d.source_id
     WHERE d.status = 'skipped'
       AND ($2::text IS NULL OR s.key = $2::text)
     ORDER BY d.fetched_at DESC
     LIMIT $1`,
    [limit, sourceKey],
  );

  // Доля нерелевантного по источникам — главный сигнал перестраховки модели.
  const bySource = await query<{ title: string; skipped: number; total: number }>(
    `SELECT s.title,
            count(*) FILTER (WHERE d.status = 'skipped')::int                   AS skipped,
            count(*) FILTER (WHERE d.status IN ('skipped', 'extracted'))::int   AS total
     FROM raw_documents d
     JOIN sources s ON s.id = d.source_id
     GROUP BY s.title
     HAVING count(*) FILTER (WHERE d.status IN ('skipped', 'extracted')) > 0
     ORDER BY 2 DESC`,
  );

  if (bySource.length > 0) {
    console.log('[skipped] доля нерелевантного по источникам:');
    for (const s of bySource) {
      const share = s.total === 0 ? 0 : (s.skipped / s.total) * 100;
      console.log(`   ${share.toFixed(0).padStart(3)} %  ${s.skipped}/${s.total}  ${s.title}`);
    }
    console.log(
      '   Отраслевое издание с высокой долей — повод подозревать модель, а не источник.\n',
    );
  }

  if (rows.length === 0) {
    console.log('[skipped] нерелевантных документов нет');
    return;
  }

  console.log(`[skipped] последние ${rows.length} — проверьте, правда ли они не по теме:\n`);
  for (const r of rows) {
    console.log(`── док ${r.id} · ${r.sourceTitle} ${r.url ? `· ${r.url}` : ''}`);
    console.log(`${r.body.slice(0, 600)}${r.body.length > 600 ? '…' : ''}\n`);
  }
  console.log(
    'Если тексты по теме — модель перестраховывается. Смягчите правило 9\n' +
      'в SYSTEM_PROMPT (src/llm/prompt.ts) и поднимите PROMPT_VERSION в .env,\n' +
      'иначе документы не переизвлекутся. Затем: --retry-skipped и --loop.',
  );
};

/** Документ целиком: исходный текст, что вернула модель, что легло в канон. */
export const showDocument = async (id: number): Promise<void> => {
  const doc = await queryOne<{
    id: number;
    body: string;
    status: string;
    attempts: number;
    lastError: string | null;
    sourceTitle: string;
    url: string | null;
  }>(
    `SELECT d.id, d.body, d.status::text AS status, d.attempts,
            d.last_error AS "lastError", d.url, s.title AS "sourceTitle"
     FROM raw_documents d JOIN sources s ON s.id = d.source_id
     WHERE d.id = $1`,
    [id],
  );

  if (!doc) {
    console.error(`[doc] документ ${id} не найден`);
    process.exitCode = 1;
    return;
  }

  console.log(`── док ${doc.id} · ${doc.sourceTitle} · статус ${doc.status} · попыток ${doc.attempts}`);
  if (doc.url) console.log(`   ${doc.url}`);
  if (doc.lastError) console.log(`   ошибка: ${doc.lastError}`);
  console.log(`\n── ТЕКСТ ──\n${doc.body}\n`);

  const extractions = await query<{
    chunkIndex: number;
    status: string;
    promptVersion: string;
    payload: unknown;
    rawResponse: string | null;
    latencyMs: number | null;
  }>(
    `SELECT chunk_index AS "chunkIndex", status::text AS status,
            prompt_version AS "promptVersion", payload,
            left(raw_response, 600) AS "rawResponse", latency_ms AS "latencyMs"
     FROM extractions WHERE document_id = $1 ORDER BY prompt_version, chunk_index`,
    [id],
  );

  for (const e of extractions) {
    console.log(`── РАЗБОР · чанк ${e.chunkIndex} · ${e.promptVersion} · ${e.status} · ${e.latencyMs ?? '?'} мс`);
    if (e.payload) console.log(JSON.stringify(e.payload, null, 2));
    if (e.rawResponse) console.log(`   ответ/ошибка: ${e.rawResponse}`);
    console.log();
  }

  const mentions = await query<{ name: string; role: string | null; verified: boolean }>(
    `SELECT c.name, m.role, m.quote_verified AS verified
     FROM mentions m JOIN companies c ON c.id = m.entity_id
     WHERE m.document_id = $1 AND m.entity_kind = 'company'`,
    [id],
  );

  console.log('── В КАНОНЕ ──');
  if (mentions.length === 0) {
    console.log('   ничего не записано');
  } else {
    for (const m of mentions) {
      console.log(`   ${m.name}${m.role ? ` (${m.role})` : ''}${m.verified ? '' : '  ЦИТАТА НЕ СВЕРЕНА'}`);
    }
  }
};

/** Вернуть в очередь то, что модель сочла нерелевантным. Для смены промпта. */
/**
 * Вернуть нерелевантные документы в очередь.
 *
 * По умолчанию — только те, что ТЕКУЩАЯ модель при ТЕКУЩЕМ промпте ещё не
 * оценивала. Это ровно случай смены модели: документы, которые отбросила
 * другая модель, заслуживают второго мнения, а те, что текущая модель уже
 * признала нерелевантными, она признает так же — прогонять их заново значит
 * жечь GPU впустую (на 8B это десятки секунд на документ).
 *
 * --all возвращает все подряд — нужно после правки самого промпта, когда
 * меняется и PROMPT_VERSION, и прежние оценки теряют силу.
 */
export const retrySkipped = async (all: boolean): Promise<void> => {
  const affected = all
    ? await execute(
        `UPDATE raw_documents
         SET status = 'queued', attempts = 0, updated_at = now()
         WHERE status = 'skipped'`,
      )
    : await execute(
        `UPDATE raw_documents d
         SET status = 'queued', attempts = 0, updated_at = now()
         WHERE d.status = 'skipped'
           AND NOT EXISTS (
             SELECT 1 FROM extractions e
             WHERE e.document_id = d.id
               AND e.model = $1
               AND e.prompt_version = $2
               AND e.status = 'ok'
           )`,
        [env.LMSTUDIO_MODEL, env.PROMPT_VERSION],
      );

  console.log(`[pipeline] возвращено в очередь: ${affected}`);
  if (all) {
    console.log('[pipeline] помните: без нового PROMPT_VERSION модель ответит то же самое');
  } else {
    console.log(
      `[pipeline] только то, что ${env.LMSTUDIO_MODEL} ещё не оценивала. ` +
        'Вернуть все подряд: --retry-skipped --all',
    );
  }
};

export const showMerges = async (): Promise<void> => {
  const pending = await listPendingMerges();
  if (pending.length === 0) {
    console.log('[merge] очередь пуста');
    return;
  }
  console.log(`[merge] пар на подтверждение: ${pending.length}`);
  for (const p of pending) {
    console.log(
      `  #${p.id} ${p.entityKind} score=${Number(p.score).toFixed(2)}\n` +
        `      «${p.sourceName}»  ->  «${p.targetName}»\n` +
        `      ${JSON.stringify(p.reasons)}`,
    );
  }
  console.log('\nПодтвердить: --merge <id>   Отклонить: --reject <id>');
};
