// Единый HTTP-клиент для внешних источников.
//
// Проверки (OWASP SSRF Prevention Cheat Sheet, см. reference/SOURCES.md):
//  - только http/https, без логина и пароля в URL, только разрешённые порты;
//  - хост из allowlist источника;
//  - адрес назначения проверяется в момент соединения: собственный lookup
//    отдаёт сокету ровно тот IP, который прошёл проверку, — подмена DNS
//    между проверкой и соединением (rebinding) не срабатывает;
//  - каждый редирект проходит все проверки заново, редиректы считаются;
//  - ограничены время и размер ответа (после распаковки).
//
// Локальная модель сюда не ходит: у неё свой фиксированный доверенный адрес
// (llm/client.ts). Исключение для loopback здесь открыло бы внутреннюю сеть
// любой ссылке из публикации.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';

import { isBlockedAddress } from './addressPolicy.js';

export type NetworkPolicyErrorKind =
  | 'bad_url'
  | 'scheme'
  | 'credentials'
  | 'port'
  | 'host_not_allowed'
  | 'blocked_address'
  | 'dns'
  | 'too_many_redirects'
  | 'oversize'
  | 'timeout'
  | 'network';

export class NetworkPolicyError extends Error {
  constructor(
    readonly kind: NetworkPolicyErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'NetworkPolicyError';
  }
}

export interface ISourceNetworkPolicy {
  /** Имена хостов в нижнем регистре. */
  allowedHosts: readonly string[];
  /** Разрешать ли поддомены allowedHosts (news.example.ru для example.ru). */
  allowSubdomains: boolean;
  /** Явно указанный порт обязан быть в списке. По умолчанию 80 и 443. */
  allowedPorts?: readonly number[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}

export const DEFAULT_SOURCE_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 30_000,
  maxRedirects: 5,
} as const;

export interface ISafeRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface ISafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  finalUrl: string;
  redirects: number;
}

type LookupAll = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/**
 * Транспорт одного запроса без редиректов. Подменяется только в тестах (локальные
 * фикстуры без сети): проверки адреса, редиректов и размера остаются в safeFetch и
 * применяются к ответу подменённого транспорта так же, как к настоящему.
 */
export type SafeTransport = (url: URL, request: ISafeRequest) => Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>;

export interface ISafeFetchDeps {
  lookup?: LookupAll;
  isAddressBlocked?: (address: string) => boolean;
  transport?: SafeTransport;
}

const defaultLookup: LookupAll = async hostname =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

const normalizeHost = (host: string): string => host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

export const hostMatchesPolicy = (host: string, policy: Pick<ISourceNetworkPolicy, 'allowedHosts' | 'allowSubdomains'>): boolean => {
  const h = normalizeHost(host);
  return policy.allowedHosts.some(raw => {
    const allowed = normalizeHost(raw);
    return h === allowed || (policy.allowSubdomains && h.endsWith(`.${allowed}`));
  });
};

/** Проверка URL без сети. Возвращает разобранный адрес или бросает. */
export const assertUrlAllowed = (
  rawUrl: string | URL,
  policy: ISourceNetworkPolicy,
  isAddressBlocked: (address: string) => boolean = isBlockedAddress,
): URL => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new NetworkPolicyError('bad_url', 'некорректный адрес');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new NetworkPolicyError('scheme', `схема ${url.protocol} запрещена`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new NetworkPolicyError('credentials', 'логин и пароль в адресе запрещены');
  }
  const ports = policy.allowedPorts ?? [80, 443];
  if (url.port !== '' && !ports.includes(Number(url.port))) {
    throw new NetworkPolicyError('port', `порт ${url.port} запрещён`);
  }
  const host = normalizeHost(url.hostname);
  if (!hostMatchesPolicy(host, policy)) {
    throw new NetworkPolicyError('host_not_allowed', `хост ${host} не входит в разрешённые для источника`);
  }
  if (net.isIP(host) !== 0 && isAddressBlocked(host)) {
    throw new NetworkPolicyError('blocked_address', `адрес ${host} запрещён`);
  }
  return url;
};

const resolveAllowed = async (
  hostname: string,
  deps: Required<Omit<ISafeFetchDeps, 'transport'>>,
): Promise<Array<{ address: string; family: number }>> => {
  const host = normalizeHost(hostname);
  const family = net.isIP(host);
  const addresses =
    family !== 0 ? [{ address: host, family }] : await deps.lookup(host).catch(() => {
      throw new NetworkPolicyError('dns', `не удалось разрешить имя ${host}`);
    });
  if (addresses.length === 0) throw new NetworkPolicyError('dns', `у имени ${host} нет адресов`);
  // Если хоть одна запись ведёт во внутреннюю сеть — не соединяемся вовсе:
  // смешанный ответ DNS для публичного сайта сам по себе подозрителен.
  const blocked = addresses.find(a => deps.isAddressBlocked(a.address));
  if (blocked) {
    throw new NetworkPolicyError('blocked_address', `имя ${host} указывает на запрещённый адрес`);
  }
  return addresses;
};

const decodeBody = (buffer: Buffer, contentType: string | undefined): string => {
  const charset = /charset=([^;]+)/i.exec(contentType ?? '')?.[1]?.trim().replace(/^"|"$/g, '') ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
};

const decompressStream = (res: http.IncomingMessage): Readable => {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (encoding === 'deflate') return res.pipe(zlib.createInflate());
  if (encoding === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
};

interface IRawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer | null;
}

const requestOnce = (
  url: URL,
  request: ISafeRequest,
  policy: ISourceNetworkPolicy,
  deps: Required<Omit<ISafeFetchDeps, 'transport'>>,
  signal: AbortSignal,
): Promise<IRawResponse> =>
  new Promise<IRawResponse>((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;

    const lookup: net.LookupFunction = (hostname, options, callback) => {
      resolveAllowed(hostname, deps).then(
        addresses => {
          const first = addresses[0];
          if ((options as { all?: boolean }).all) {
            callback(null, addresses as dns.LookupAddress[]);
          } else if (first) {
            callback(null, first.address, first.family);
          }
        },
        (err: unknown) => callback(err as NodeJS.ErrnoException, '', 0),
      );
    };

    const req = lib.request(
      url,
      {
        method: request.method ?? 'GET',
        headers: { 'accept-encoding': 'gzip, deflate, br', ...request.headers },
        lookup,
        signal,
      },
      res => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ status, headers: res.headers, body: null });
          return;
        }

        const declared = Number(res.headers['content-length'] ?? '0');
        if (Number.isFinite(declared) && declared > policy.maxBytes) {
          res.destroy();
          reject(new NetworkPolicyError('oversize', `ответ больше ${policy.maxBytes} байт`));
          return;
        }

        const stream = decompressStream(res);
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > policy.maxBytes) {
            stream.destroy();
            res.destroy();
            reject(new NetworkPolicyError('oversize', `ответ больше ${policy.maxBytes} байт`));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        stream.on('error', err => reject(new NetworkPolicyError('network', `ошибка чтения ответа: ${err.message}`)));
      },
    );

    req.on('error', (err: Error) => {
      if (err instanceof NetworkPolicyError) {
        reject(err);
      } else if (signal.aborted) {
        reject(new NetworkPolicyError('timeout', `истекло время ожидания ${policy.timeoutMs} мс`));
      } else {
        reject(new NetworkPolicyError('network', `сеть недоступна: ${(err as NodeJS.ErrnoException).code ?? err.name}`));
      }
    });

    if (request.body !== undefined) req.write(request.body);
    req.end();
  });

/** Ответ подменённого транспорта проходит те же правила редиректа и размера. */
const viaTransport = async (
  transport: SafeTransport,
  url: URL,
  request: ISafeRequest,
  policy: ISourceNetworkPolicy,
): Promise<IRawResponse> => {
  const res = await transport(url, request);
  if (res.status >= 300 && res.status < 400 && res.headers.location) return { status: res.status, headers: res.headers, body: null };
  if (res.body.length > policy.maxBytes) throw new NetworkPolicyError('oversize', `ответ больше ${policy.maxBytes} байт`);
  return { status: res.status, headers: res.headers, body: res.body };
};

export const safeFetch = async (
  rawUrl: string | URL,
  policy: ISourceNetworkPolicy,
  request: ISafeRequest = {},
  depsIn: ISafeFetchDeps = {},
): Promise<ISafeResponse> => {
  const deps: Required<Omit<ISafeFetchDeps, 'transport'>> = {
    lookup: depsIn.lookup ?? defaultLookup,
    isAddressBlocked: depsIn.isAddressBlocked ?? isBlockedAddress,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), policy.timeoutMs);

  try {
    let url = assertUrlAllowed(rawUrl, policy, deps.isAddressBlocked);
    let current = request;

    for (let redirects = 0; ; redirects += 1) {
      const raw = depsIn.transport
        ? await viaTransport(depsIn.transport, url, current, policy)
        : await requestOnce(url, current, policy, deps, controller.signal);

      if (raw.body === null) {
        if (redirects >= policy.maxRedirects) {
          throw new NetworkPolicyError('too_many_redirects', `больше ${policy.maxRedirects} перенаправлений`);
        }
        const location = String(raw.headers.location);
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new NetworkPolicyError('bad_url', 'некорректный адрес перенаправления');
        }
        // Перенаправление проверяется так же строго, как исходный адрес.
        url = assertUrlAllowed(next, policy, deps.isAddressBlocked);
        const keepMethod = raw.status === 307 || raw.status === 308;
        current = keepMethod ? current : { headers: current.headers };
        continue;
      }

      return {
        status: raw.status,
        headers: raw.headers,
        text: decodeBody(raw.body, raw.headers['content-type']),
        finalUrl: url.toString(),
        redirects,
      };
    }
  } finally {
    clearTimeout(timer);
  }
};
