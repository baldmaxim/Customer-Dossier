// Запрос страницы источника через безопасный клиент (этап 05A): условные заголовки,
// классификация исходов. 304, 429, 403, запрет политики, DNS, размер — разные исходы,
// ни один не превращается в «новостей нет».

import type { PoolClient } from 'pg';

import { env } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import {
  NetworkPolicyError,
  safeFetch,
  type ISafeFetchDeps,
  type ISourceNetworkPolicy,
  type SafeTransport,
} from '../../net/safeFetch.js';

export type SiteFetchResult =
  | { kind: 'ok'; status: number; text: string; finalUrl: string; etag: string | null; lastModified: string | null }
  | { kind: 'not_modified'; status: 304 }
  | { kind: 'http'; status: number; retryAfterAt: Date | null; message: string }
  | { kind: 'policy' | 'dns' | 'network' | 'timeout' | 'oversize'; status: null; message: string };

/** Тестовый транспорт: локальные фикстуры без сети; политика адресов остаётся в safeFetch. */
let transport: SafeTransport | undefined;
export const setSiteTransportForTests = (next: SafeTransport | undefined): void => {
  transport = next;
};

const header = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

/** Retry-After: секунды или HTTP-дата. */
export const parseRetryAfter = (value: string | null, now: Date = new Date()): Date | null => {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return new Date(now.getTime() + Math.min(seconds, 86_400) * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const POLICY_KINDS = new Set(['bad_url', 'scheme', 'credentials', 'port', 'host_not_allowed', 'blocked_address', 'too_many_redirects']);

export interface IConditional {
  etag: string | null;
  lastModified: string | null;
}

export const loadConditional = async (sourceId: number, url: string): Promise<IConditional | null> =>
  (
    await getPool().query<{ etag: string | null; last_modified: string | null }>(
      'SELECT etag, last_modified FROM http_cache WHERE source_id = $1 AND url = $2',
      [sourceId, url],
    )
  ).rows.map(r => ({ etag: r.etag, lastModified: r.last_modified }))[0] ?? null;

export const saveConditional = async (client: PoolClient, sourceId: number, url: string, result: SiteFetchResult): Promise<void> => {
  if (result.kind !== 'ok' && result.kind !== 'not_modified') return;
  await client.query(
    `INSERT INTO http_cache (source_id, url, etag, last_modified, last_status, checked_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (source_id, url) DO UPDATE SET
       etag = coalesce(EXCLUDED.etag, http_cache.etag),
       last_modified = coalesce(EXCLUDED.last_modified, http_cache.last_modified),
       last_status = EXCLUDED.last_status, checked_at = now()`,
    [
      sourceId,
      url,
      result.kind === 'ok' ? result.etag : null,
      result.kind === 'ok' ? result.lastModified : null,
      result.status,
    ],
  );
};

export const fetchSitePage = async (
  url: string,
  policy: ISourceNetworkPolicy,
  conditional: IConditional | null,
): Promise<SiteFetchResult> => {
  const headers: Record<string, string> = {
    'user-agent': env.INGEST_USER_AGENT,
    'accept-language': 'ru,en;q=0.8',
  };
  if (conditional?.etag) headers['if-none-match'] = conditional.etag;
  if (conditional?.lastModified) headers['if-modified-since'] = conditional.lastModified;
  const deps: ISafeFetchDeps = transport ? { transport } : {};

  try {
    const res = await safeFetch(url, policy, { headers }, deps);
    if (res.status === 304) return { kind: 'not_modified', status: 304 };
    if (res.status < 200 || res.status >= 300) {
      return {
        kind: 'http',
        status: res.status,
        retryAfterAt: res.status === 429 || res.status === 503 ? parseRetryAfter(header(res.headers['retry-after'])) : null,
        message: `HTTP ${res.status}`,
      };
    }
    return {
      kind: 'ok',
      status: res.status,
      text: res.text,
      finalUrl: res.finalUrl,
      etag: header(res.headers.etag),
      lastModified: header(res.headers['last-modified']),
    };
  } catch (err) {
    if (err instanceof NetworkPolicyError) {
      const kind = POLICY_KINDS.has(err.kind) ? 'policy' : err.kind === 'dns' ? 'dns' : err.kind === 'oversize' ? 'oversize' : err.kind === 'timeout' ? 'timeout' : 'network';
      return { kind, status: null, message: `${err.kind}: ${err.message}` };
    }
    return { kind: 'network', status: null, message: err instanceof Error ? err.message : String(err) };
  }
};
