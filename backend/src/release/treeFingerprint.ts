// Отпечаток состояния кода для привязки логов прогона (закрытие приёмки 09). Только чтение Git и файлов.
//
//   npm run release:fingerprint [-- --out tree.json]
//
// HEAD + sha256 по содержимому всех отслеживаемых и неигнорируемых неотслеживаемых файлов рабочего дерева
// (то есть с незакоммиченными правками). Исключены: .env*, backend/.local, архивы *.zip, node_modules, dist,
// а также отчёты и логи docs/development/ и пакеты промтов prompts/ — иначе запись лога меняла бы отпечаток кода,
// к которому лог относится. Миграции docs/migrations входят в отпечаток.
// Содержимое файлов и секреты не печатаются: только HEAD, число изменённых путей и итоговый hash.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const EXCLUDED = [/(^|\/)\.env($|\.)/, /(^|\/)\.local\//, /\.zip$/i, /(^|\/)node_modules\//, /(^|\/)dist\//, /^docs\/development\//, /^prompts\//, /^[^/]+\.md$/];

export const isExcluded = (file: string): boolean => EXCLUDED.some(re => re.test(file)) && !/\.env\.example$/.test(file);

const git = (args: string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const main = (): void => {
  const head = git(['rev-parse', 'HEAD']).trim();
  const files = git(['ls-files', '-co', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter(f => !isExcluded(f))
    .sort();
  const hash = createHash('sha256');
  let hashed = 0;
  for (const file of files) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue; // удалённый в рабочем дереве файл
    hash.update(`${file}\0`);
    hash.update(fs.readFileSync(full));
    hash.update('\0');
    hashed += 1;
  }
  const status = git(['status', '--porcelain=v1', '-z']).split('\0').filter(Boolean);
  const dirty = status.map(s => s.slice(3)).filter(f => f && !isExcluded(f));
  const report = {
    version: 'tree-fingerprint@1',
    takenAt: new Date().toISOString(),
    head,
    dirtyPaths: dirty.length,
    filesHashed: hashed,
    treeSha256: hash.digest('hex'),
    excluded: '.env*, backend/.local, *.zip, node_modules, dist, docs/development/, prompts/, *.md в корне',
  };
  console.log(`[fingerprint] HEAD ${report.head}${report.dirtyPaths ? ` + незакоммиченных путей ${report.dirtyPaths}` : ' (чистое дерево)'}`);
  console.log(`[fingerprint] файлов ${report.filesHashed}, sha256 ${report.treeSha256}`);
  const i = process.argv.indexOf('--out');
  const out = i >= 0 ? process.argv[i + 1] : undefined;
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[fingerprint] записан: ${out}`);
  }
};

main();
