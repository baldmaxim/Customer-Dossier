// TC-006: SSRF — внутренний адрес, DNS и редирект не уводят запрос в локальную сеть.
// TC-007: исключения для локальной модели в политике источников нет.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { isBlockedAddress } from './addressPolicy.js';
import { NetworkPolicyError, assertUrlAllowed, safeFetch, type ISourceNetworkPolicy } from './safeFetch.js';

const policy = (over: Partial<ISourceNetworkPolicy> = {}): ISourceNetworkPolicy => ({
  allowedHosts: ['example.ru'],
  allowSubdomains: true,
  maxBytes: 1024 * 1024,
  timeoutMs: 5000,
  maxRedirects: 3,
  ...over,
});

const expectPolicyError = async (promise: Promise<unknown>, kind: string): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(NetworkPolicyError);
  await promise.catch((err: NetworkPolicyError) => expect(err.kind).toBe(kind));
};

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // metadata облаков
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    'not-an-ip',
  ])('%s запрещён', address => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '93.184.216.34', '172.32.0.1', '2a00:1450:4010:c0e::65', '::ffff:8.8.8.8'])(
    '%s разрешён',
    address => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('assertUrlAllowed — без сети', () => {
  it('разрешает хост источника и его поддомены', () => {
    expect(assertUrlAllowed('https://example.ru/rss', policy()).hostname).toBe('example.ru');
    expect(assertUrlAllowed('https://news.example.ru/a', policy()).hostname).toBe('news.example.ru');
  });

  it('чужой хост и похожий суффикс отклоняются', () => {
    expect(() => assertUrlAllowed('https://evil.ru/', policy())).toThrow(/не входит в разрешённые/);
    expect(() => assertUrlAllowed('https://notexample.ru/', policy())).toThrow(NetworkPolicyError);
    expect(() => assertUrlAllowed('https://example.ru.evil.com/', policy())).toThrow(NetworkPolicyError);
  });

  it('схемы кроме http/https, логин в URL и чужие порты запрещены', () => {
    expect(() => assertUrlAllowed('file:///etc/passwd', policy())).toThrow(/схема/);
    expect(() => assertUrlAllowed('gopher://example.ru/', policy())).toThrow(/схема/);
    expect(() => assertUrlAllowed('https://user:pass@example.ru/', policy())).toThrow(/логин/);
    expect(() => assertUrlAllowed('https://example.ru:8080/', policy())).toThrow(/порт/);
  });

  it('IP-литерал внутренней сети отклоняется даже если внесён в allowlist', () => {
    const p = policy({ allowedHosts: ['169.254.169.254', '127.0.0.1'] });
    expect(() => assertUrlAllowed('http://169.254.169.254/latest/meta-data', p)).toThrow(/запрещён/);
    expect(() => assertUrlAllowed('http://127.0.0.1/', p)).toThrow(/запрещён/);
  });

  it('адрес LM Studio по политике источников не проходит (TC-007)', () => {
    // Локальная модель — отдельный доверенный клиент (llm/client.ts). Здесь
    // исключения для loopback нет: иначе его получила бы любая ссылка из ленты.
    const p = policy({ allowedHosts: ['localhost', '127.0.0.1'], allowedPorts: [1234] });
    expect(() => assertUrlAllowed('http://127.0.0.1:1234/v1/models', p)).toThrow(/запрещён/);
  });
});

describe('safeFetch — с настоящим HTTP-сервером', () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('привет');
      } else if (req.url === '/gzip') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-encoding': 'gzip' });
        res.end(zlib.gzipSync('сжатый текст'));
      } else if (req.url === '/to-metadata') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
        res.end();
      } else if (req.url === '/to-other-host') {
        res.writeHead(301, { location: 'https://evil.ru/' });
        res.end();
      } else if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' });
        res.end();
      } else if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(5000));
      } else if (req.url === '/big-gzip') {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
        res.end(zlib.gzipSync('x'.repeat(50_000)));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  // Тестовый стенд: имя site.test резолвится в 127.0.0.1, и именно этот адрес
  // разрешён. Всё остальное проверяется штатной политикой адресов.
  const deps = {
    lookup: async (host: string) => {
      if (host === 'site.test') return [{ address: '127.0.0.1', family: 4 }];
      if (host === 'rebind.test') return [{ address: '10.0.0.7', family: 4 }];
      if (host === 'mixed.test') return [{ address: '127.0.0.1', family: 4 }, { address: '192.168.0.10', family: 4 }];
      throw new Error('ENOTFOUND');
    },
    isAddressBlocked: (address: string) => (address === '127.0.0.1' ? false : isBlockedAddress(address)),
  };
  const testPolicy = (over: Partial<ISourceNetworkPolicy> = {}) =>
    policy({ allowedHosts: ['site.test', 'rebind.test', 'mixed.test'], allowedPorts: [port], ...over });

  it('обычный ответ читается', async () => {
    const res = await safeFetch(`http://site.test:${port}/ok`, testPolicy(), {}, deps);
    expect(res.status).toBe(200);
    expect(res.text).toBe('привет');
  });

  it('сжатый ответ распаковывается', async () => {
    const res = await safeFetch(`http://site.test:${port}/gzip`, testPolicy(), {}, deps);
    expect(res.text).toBe('сжатый текст');
  });

  it('имя, резолвящееся во внутреннюю сеть, блокируется до соединения (DNS)', async () => {
    const before = hits.length;
    await expectPolicyError(safeFetch(`http://rebind.test:${port}/ok`, testPolicy(), {}, deps), 'blocked_address');
    expect(hits.length).toBe(before);
  });

  it('смешанный ответ DNS с внутренним адресом блокируется целиком', async () => {
    await expectPolicyError(safeFetch(`http://mixed.test:${port}/ok`, testPolicy(), {}, deps), 'blocked_address');
  });

  it('редирект на metadata-адрес блокируется', async () => {
    await expectPolicyError(
      safeFetch(`http://site.test:${port}/to-metadata`, testPolicy(), {}, deps),
      'host_not_allowed',
    );
    // Даже если хост внесён в allowlist, адрес запрещён.
    await expectPolicyError(
      safeFetch(
        `http://site.test:${port}/to-metadata`,
        testPolicy({ allowedHosts: ['site.test', '169.254.169.254'], allowedPorts: [port, 80] }),
        {},
        deps,
      ),
      'blocked_address',
    );
  });

  it('редирект на чужой хост блокируется', async () => {
    await expectPolicyError(
      safeFetch(`http://site.test:${port}/to-other-host`, testPolicy(), {}, deps),
      'host_not_allowed',
    );
  });

  it('бесконечные редиректы обрываются', async () => {
    await expectPolicyError(safeFetch(`http://site.test:${port}/loop`, testPolicy(), {}, deps), 'too_many_redirects');
  });

  it('ответ больше лимита не читается целиком', async () => {
    await expectPolicyError(
      safeFetch(`http://site.test:${port}/big`, testPolicy({ maxBytes: 1000 }), {}, deps),
      'oversize',
    );
  });

  it('лимит считается после распаковки (защита от gzip-бомбы)', async () => {
    await expectPolicyError(
      safeFetch(`http://site.test:${port}/big-gzip`, testPolicy({ maxBytes: 10_000 }), {}, deps),
      'oversize',
    );
  });

  it('по умолчанию loopback-сервер недоступен, даже если он реально слушает', async () => {
    const before = hits.length;
    await expectPolicyError(
      safeFetch(`http://127.0.0.1:${port}/ok`, policy({ allowedHosts: ['127.0.0.1'], allowedPorts: [port] })),
      'blocked_address',
    );
    await expectPolicyError(
      safeFetch(`http://localhost:${port}/ok`, policy({ allowedHosts: ['localhost'], allowedPorts: [port] })),
      'blocked_address',
    );
    expect(hits.length).toBe(before);
  });
});
