// Подтверждённый сайт компании → источник чтения (этап 25B, ADR-018).
//
// Ключ — «site:<хост>», а не хост: у того же хоста может быть новостной профиль (ключ — хост), и ON CONFLICT
// addWebsiteSource перезаписал бы его config. Источник один на хост, даже если сайт подтверждён у группы и её СЗ.
// «Это сайт компании» — решение оператора и есть допуск: сбор и ИИ-обработка включаются тем же setSourceEnabled,
// что и кнопка «Сбор», с основанием «сайт компании подтверждён оператором <логин>» (журнал source_policy_log).
// «Отвязать» последнего подтвердившего — источник на паузу, допуски отозваны; собранные снимки остаются.

import { query, queryOne } from '../db/pool.js';
import { setSourceEnabled } from '../ingest/sources.js';

/** Сайт компании меняется медленно: раз в трое суток. */
export const COMPANY_SITE_POLL_SEC = 3 * 24 * 60 * 60;

export const companySiteSourceKey = (host: string): string => `site:${host}`;

export const companySiteConfig = (url: string): Record<string, unknown> => ({ version: 1, mode: 'company_site', homepage: url });

const basisFor = (actor: string): { basis: string; owner: string } => ({
  basis: `Сайт компании подтверждён оператором ${actor}`,
  owner: actor,
});

/** Источник сайта: есть — тот же, нет — заводится на паузе; затем включается решением оператора. */
export const ensureCompanySiteSource = async (host: string, url: string, actor: string): Promise<number> => {
  const key = companySiteSourceKey(host);
  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO sources (kind, key, title, base_url, status, config, poll_interval_sec)
     VALUES ('website', $1, $2, $3, 'paused', $4::jsonb, $5)
     ON CONFLICT (kind, key) DO NOTHING
     RETURNING id`,
    [key, host, url, JSON.stringify(companySiteConfig(url)), COMPANY_SITE_POLL_SEC],
  );
  const id = inserted?.id ?? (await queryOne<{ id: number }>(`SELECT id FROM sources WHERE kind = 'website' AND key = $1`, [key]))?.id;
  if (!id) throw new Error(`источник сайта ${host} не заведён`);
  await setSourceEnabled(id, true, actor, basisFor(actor));
  return id;
};

/** Подтверждённый кандидат → источник: заводит (или включает) и запоминает его у кандидата. */
export const attachCompanySiteSource = async (candidateId: number, actor: string): Promise<number | null> => {
  const candidate = await queryOne<{ host: string; url: string; state: string }>(
    'SELECT host, url, state FROM company_site_candidates WHERE id = $1',
    [candidateId],
  );
  if (!candidate || candidate.state !== 'confirmed') return null;
  const sourceId = await ensureCompanySiteSource(candidate.host, candidate.url, actor);
  await query('UPDATE company_site_candidates SET source_id = $2 WHERE id = $1', [candidateId, sourceId]);
  return sourceId;
};

/** Сайт отвязан: если других подтверждений этого источника нет — пауза и отзыв допусков. */
export const releaseCompanySiteSource = async (sourceId: number | null, actor: string): Promise<boolean> => {
  if (sourceId === null) return false;
  const others = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM company_site_candidates WHERE source_id = $1 AND state = 'confirmed'`,
    [sourceId],
  );
  if ((others?.n ?? 0) > 0) return false;
  await setSourceEnabled(sourceId, false, actor);
  return true;
};

/**
 * Подтверждённые без источника — решения 25A, принятые до выпуска 25B: получают источник от имени того, кто
 * подтверждал. Идёт в тике сбора; без новых подтверждений — один пустой запрос.
 */
export const syncCompanySiteSources = async (limit = 20): Promise<number> => {
  const rows = await query<{ id: number; decided_by: string | null }>(
    `SELECT id, decided_by FROM company_site_candidates WHERE state = 'confirmed' AND source_id IS NULL ORDER BY id LIMIT $1`,
    [limit],
  );
  let attached = 0;
  for (const row of rows) {
    if ((await attachCompanySiteSource(row.id, row.decided_by ?? 'operator')) !== null) attached += 1;
  }
  return attached;
};
