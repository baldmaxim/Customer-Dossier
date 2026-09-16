// Проба уже запущенного отдельного процесса API (закрытие приёмки 09): перезапуск и чтение после восстановления.
//
//   npm run release:probe -- --snapshot 1 [--case 1] [--base http://127.0.0.1:4100] [--out probe-before.json]
//   npm run release:probe -- --snapshot 1 --compare probe-before.json
//
// Только loopback и только чтение: вход оператора (сессия в памяти процесса, база не пишется) и GET снимка,
// его выгрузок и досье обращения. Печатаются коды ответов и sha256, не содержимое. Токен берётся из
// OPERATOR_TOKEN окружения, backend/.env или backend/.local/operator-token и нигде не выводится; новый файл
// токена проба не создаёт. База данных напрямую не открывается.

import { createHash } from 'node:crypto';
import fs from 'node:fs';

import dotenv from 'dotenv';

import { TOKEN_FILE } from '../api/operatorToken.js';
import { isLoopbackHost } from '../config/parse.js';
import { BACKEND_DOTENV_PATH } from '../db/testTargetBootstrap.js';
import { payloadHash } from '../snapshot/canonical.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export interface IProbeReport {
  version: 'release-probe@1';
  takenAt: string;
  base: string;
  snapshotId: number;
  caseId: number | null;
  checks: Record<string, { status: number; sha256: string | null; note: string }>;
}

const readToken = (): string => {
  const fromEnv = process.env.OPERATOR_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync(BACKEND_DOTENV_PATH)) {
    const fromFile = dotenv.parse(fs.readFileSync(BACKEND_DOTENV_PATH)).OPERATOR_TOKEN?.trim();
    if (fromFile) return fromFile;
  }
  if (fs.existsSync(TOKEN_FILE)) {
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (token.length >= 32) return token;
  }
  throw new Error('токен оператора не найден (OPERATOR_TOKEN или backend/.local/operator-token); проба его не создаёт');
};

const main = async (): Promise<void> => {
  const base = new URL(flag('--base') ?? 'http://127.0.0.1:4100');
  if (!isLoopbackHost(base.hostname.replace(/^\[|\]$/g, ''))) throw new Error('проба работает только с loopback-адресом');
  const snapshotId = Number.parseInt(flag('--snapshot') ?? '', 10);
  if (!Number.isSafeInteger(snapshotId) || snapshotId <= 0) throw new Error('укажите --snapshot <id>');
  const caseArg = flag('--case');
  const caseId = caseArg === null ? null : Number.parseInt(caseArg, 10);
  const origin = base.origin;

  const login = await fetch(new URL('/api/auth/login', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ token: readToken() }),
  });
  if (login.status !== 200) throw new Error(`вход не выполнен: HTTP ${login.status}`);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const csrf = String(((await login.json()) as { csrfToken?: string }).csrfToken ?? '');
  const headers = { cookie, origin };

  const checks: IProbeReport['checks'] = {};
  const get = async (key: string, path: string, digest: (text: string) => { sha256: string | null; note: string }) => {
    const res = await fetch(new URL(path, base), { headers });
    const text = await res.text();
    checks[key] = res.status === 200 ? { status: res.status, ...digest(text) } : { status: res.status, sha256: null, note: 'ошибка ответа' };
  };

  await get('snapshot', `/api/snapshots/${snapshotId}`, text => {
    const body = JSON.parse(text) as { payload: unknown; integrity: { verified: boolean; storedHash: string } };
    return { sha256: payloadHash(body.payload), note: `integrity.verified=${body.integrity.verified}, storedHash=${body.integrity.storedHash}` };
  });
  for (const format of ['html', 'md']) {
    await get(`export_${format}`, `/api/snapshots/${snapshotId}/export.${format}`, text => ({ sha256: sha256(text), note: `байт ${Buffer.byteLength(text)}` }));
  }
  // JSON-выгрузка несёт availability.checkedAt — время проверки допуска при выдаче, оно законно меняется на каждый запрос.
  // Сравнивается всё остальное: снимок, payload, решения о доступности источников.
  await get('export_json', `/api/snapshots/${snapshotId}/export.json`, text => {
    const body = JSON.parse(text) as { availability?: Record<string, unknown> };
    const { checkedAt: _c, ...availability } = body.availability ?? {};
    return { sha256: payloadHash({ ...body, availability }), note: `байт ${Buffer.byteLength(text)}, без availability.checkedAt` };
  });
  if (caseId !== null) {
    // Живое досье строится при открытии (generatedAt меняется) — сравнивается без времени построения.
    await get('case_dossier', `/api/cases/${caseId}/dossier`, text => {
      const { generatedAt: _g, ...rest } = JSON.parse(text) as Record<string, unknown>;
      return { sha256: payloadHash(rest), note: 'без generatedAt' };
    });
  }
  await fetch(new URL('/api/auth/logout', base), { method: 'POST', headers: { ...headers, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined);

  const report: IProbeReport = { version: 'release-probe@1', takenAt: new Date().toISOString(), base: origin, snapshotId, caseId, checks };
  for (const [key, c] of Object.entries(checks)) console.log(`[probe] ${key}: HTTP ${c.status}${c.sha256 ? ` sha256 ${c.sha256}` : ''} — ${c.note}`);
  const failed = Object.values(checks).some(c => c.status !== 200);

  const out = flag('--out');
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[probe] записан: ${out}`);
  }
  const compare = flag('--compare');
  let differs = false;
  if (compare) {
    const before = JSON.parse(fs.readFileSync(compare, 'utf8')) as IProbeReport;
    for (const key of new Set([...Object.keys(before.checks), ...Object.keys(checks)])) {
      const a = before.checks[key];
      const b = checks[key];
      if (!a || !b || a.status !== b.status || a.sha256 !== b.sha256) {
        differs = true;
        console.log(`[probe] РАСХОЖДЕНИЕ ${key}: HTTP ${a?.status ?? '—'} → ${b?.status ?? '—'}, sha256 ${a?.sha256 === b?.sha256 ? 'совпадает' : 'отличается'}`);
      }
    }
    if (!differs) console.log(`[probe] совпадает с ${compare}`);
  }
  if (failed || differs) process.exitCode = 1;
};

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(err => {
    console.error('[probe] прервано:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
