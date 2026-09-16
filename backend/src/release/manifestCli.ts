// Содержательный manifest для проверки восстановления (content-manifest@1). Только чтение (DATABASE_URL).
//
//   npm run release:manifest -- --out before-manifest.json          снять manifest (baseline)
//   npm run release:manifest -- --compare before-manifest.json      сравнить текущую базу с сохранённым
//
// Exit 0 — только MATCH (при --compare) или manifest без проблем (без --compare).
// MISMATCH / INCOMPLETE / INCOMPATIBLE и проблемы целостности — exit 1. Печатаются коды и имена, не значения.

import fs from 'node:fs';

import { env } from '../config/env.js';
import { closeDb, getPool } from '../db/pool.js';
import { diffManifest, manifestProblems, pickConfig, type IContentManifest } from './manifest.js';
import { collectManifest } from './manifestCollect.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

const main = async (): Promise<void> => {
  const client = await getPool().connect();
  let manifest: IContentManifest;
  try {
    manifest = await collectManifest(client, { config: pickConfig(env) });
  } finally {
    client.release();
  }

  const rows = Object.values(manifest.tables).reduce((s, t) => s + t.rows, 0);
  console.log(`[manifest] ${manifest.version} · ${manifest.serialization} · база ${manifest.meta.database}${manifest.meta.isTestTarget ? ' (маркер тестовой цели)' : ''}`);
  console.log(`[manifest] таблиц ${Object.keys(manifest.tables).length}, строк ${rows}, миграций ${manifest.migrations.applied}, последовательностей ${manifest.sequences.states.length}, снимков ${manifest.snapshots.total}`);
  console.log(`[manifest] разделы схемы: ${Object.entries(manifest.schema).map(([k, v]) => `${k}=${v.count}`).join(', ')}`);

  const out = flag('--out');
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`[manifest] записан: ${out}`);
  }

  const compare = flag('--compare');
  if (!compare) {
    const problems = manifestProblems(manifest);
    for (const p of problems) console.log(`[manifest] ПРОБЛЕМА ${p.code}: ${p.subject}`);
    if (problems.length > 0) process.exitCode = 1;
    else console.log('[manifest] проблем нет');
    return;
  }

  const before = JSON.parse(fs.readFileSync(compare, 'utf8')) as Partial<IContentManifest>;
  const diff = diffManifest(before, manifest);
  console.log(`[manifest] сравнение с ${compare}: ${diff.verdict}`);
  for (const p of diff.problems) console.log(`  [${p.section}] ${p.code}: ${p.subject}`);
  if (diff.verdict !== 'MATCH') process.exitCode = 1;
};

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    console.error('[manifest] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
