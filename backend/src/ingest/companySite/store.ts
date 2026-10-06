// Запись страницы сайта компании (этап 25B, миграция 046): снимок текста на дату, новая строка — только когда
// текст страницы изменился. Допуск на сбор перепроверяется в той же транзакции под блокировкой строки источника:
// «Отвязать» во время прохода не должно оставить после себя новых снимков (как у каналов, telegram/webCrawler.ts).

import { createHash } from 'node:crypto';

import { withTransaction } from '../../db/pool.js';
import { evaluateSourcePolicy, type PermissionStatus } from '../policy.js';
import { COMPANY_SITE_PARSER_VERSION } from './profile.js';

/** Предел текста страницы: длиннее — хвост отрезается (CHECK в миграции 046). */
export const PAGE_TEXT_MAX = 60_000;

export interface ISitePage {
  url: string;
  title: string | null;
  text: string;
}

export type SavePageOutcome = 'saved' | 'unchanged';

export class SiteCollectRevokedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SiteCollectRevokedError';
  }
}

export const pageHash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Текст в пределе — по символам, а не по UTF-16: суррогатная пара не рвётся. */
export const clipText = (text: string): string => {
  const chars = Array.from(text);
  return chars.length <= PAGE_TEXT_MAX ? text : chars.slice(0, PAGE_TEXT_MAX).join('');
};

export const saveSitePage = async (sourceId: number, page: ISitePage): Promise<SavePageOutcome> =>
  withTransaction(async client => {
    const row = (
      await client.query<{ key: string; access_status: PermissionStatus; ai_processing_status: PermissionStatus; policy_expires_at: Date | null }>(
        'SELECT key, access_status, ai_processing_status, policy_expires_at FROM sources WHERE id = $1 FOR UPDATE',
        [sourceId],
      )
    ).rows[0];
    if (!row) throw new SiteCollectRevokedError('источник удалён');
    const decision = evaluateSourcePolicy(
      {
        key: row.key,
        accessStatus: row.access_status,
        aiProcessingStatus: row.ai_processing_status,
        policyExpiresAt: row.policy_expires_at,
      },
      'collect',
    );
    if (!decision.allowed) throw new SiteCollectRevokedError(decision.reason ?? 'допуск на сбор отозван');
    const text = clipText(page.text);
    const hash = pageHash(text);
    const latest = await client.query<{ content_hash: string }>(
      `SELECT content_hash FROM company_site_pages WHERE source_id = $1 AND url = $2 ORDER BY fetched_at DESC, id DESC LIMIT 1`,
      [sourceId, page.url],
    );
    if (latest.rows[0]?.content_hash === hash) return 'unchanged';
    await client.query(
      `INSERT INTO company_site_pages (source_id, url, title, text, content_hash, parser_version) VALUES ($1, $2, $3, $4, $5, $6)`,
      [sourceId, page.url, page.title?.slice(0, 500) ?? null, text, hash, COMPANY_SITE_PARSER_VERSION],
    );
    return 'saved';
  });
