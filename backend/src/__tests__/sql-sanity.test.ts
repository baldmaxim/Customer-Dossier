// Статическая проверка SQL во всём бэкенде.
//
// Повод: в apply.ts жила незакрытая скобка — `AND ($3 OR coalesce(...) < $4`.
// TypeScript такое не видит, тесты без базы не выполняют, и обнаружилось это
// только на живых данных, когда запись в канонический слой падала с
// «syntax error at end of input». Пока прогона против настоящего PostgreSQL
// в CI нет, этот тест — единственный барьер для целого класса опечаток.
//
// Проверяются два свойства, которые ловятся без БД:
//   1. баланс скобок;
//   2. плейсхолдеры $1..$N идут подряд, без пропусков.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const collectFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [full]
      : [];
  });

/** Шаблонные литералы. Вложенные `${...}` заменяются на безобидный идентификатор. */
const extractTemplateLiterals = (source: string): string[] => {
  const literals: string[] = [];
  let index = 0;

  while (index < source.length) {
    const start = source.indexOf('`', index);
    if (start === -1) break;

    let end = start + 1;
    while (end < source.length && source[end] !== '`') {
      if (source[end] === '\\') end += 1;
      end += 1;
    }
    if (end >= source.length) break;

    literals.push(source.slice(start + 1, end));
    index = end + 1;
  }

  return literals;
};

/**
 * Шаблонные константы файла: `const NAME = \`...\``.
 *
 * Общий фрагмент запроса (например, CTE) выносят в константу и подставляют
 * через ${NAME}. Если такую подстановку заменить заглушкой, плейсхолдеры
 * внутри фрагмента станут невидимы, и сканер объявит их пропущенными — ложная
 * тревога. Если же проверку для подстановок отключить, сканер ослепнет ровно
 * там, где ошибиться легче всего: номер плейсхолдера и его значение живут
 * в разных местах файла. Поэтому известные константы подставляются по-настоящему.
 */
const collectTemplateConstants = (source: string): Map<string, string> => {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*`([^`]*)`/g)) {
    if (match[1] && match[2] !== undefined) constants.set(match[1], match[2]);
  }
  return constants;
};

const inlineConstants = (literal: string, constants: ReadonlyMap<string, string>): string =>
  literal.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (whole, name: string) => constants.get(name) ?? whole);

const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|SET)\b/i;

const looksLikeSql = (literal: string): boolean => SQL_START.test(literal);

/**
 * Убирает то, что не участвует в структуре запроса: интерполяции, строковые
 * литералы SQL и построчные комментарии. Внутри них скобки не считаются.
 */
const stripNonStructural = (sql: string): string =>
  sql
    .replace(/\$\{[^}]*\}/g, ' interpolated ')
    .replace(/'(?:[^']|'')*'/g, " 'literal' ")
    .replace(/--[^\n]*/g, ' ');

const parenBalance = (sql: string): number => {
  let depth = 0;
  let lowest = 0;
  for (const ch of stripNonStructural(sql)) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      lowest = Math.min(lowest, depth);
    }
  }
  // lowest < 0 означает лишнюю закрывающую скобку где-то в середине.
  return depth === 0 && lowest === 0 ? 0 : depth || lowest;
};

const placeholderGaps = (sql: string): number[] => {
  const cleaned = stripNonStructural(sql);
  const used = new Set<number>();
  for (const match of cleaned.matchAll(/\$(\d+)/g)) {
    used.add(Number.parseInt(match[1] ?? '0', 10));
  }
  if (used.size === 0) return [];

  const max = Math.max(...used);
  const missing: number[] = [];
  for (let n = 1; n <= max; n += 1) if (!used.has(n)) missing.push(n);
  return missing;
};

interface ISqlSite {
  file: string;
  sql: string;
}

const collectSqlSites = (): ISqlSite[] => {
  const sites: ISqlSite[] = [];
  for (const file of collectFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    const constants = collectTemplateConstants(source);
    for (const literal of extractTemplateLiterals(source)) {
      if (looksLikeSql(literal)) {
        sites.push({ file: path.relative(SRC, file), sql: inlineConstants(literal, constants) });
      }
    }
  }
  return sites;
};

describe('SQL во всём бэкенде', () => {
  const sites = collectSqlSites();

  it('находит запросы для проверки', () => {
    // Если сборщик сломается, тест обязан упасть, а не тихо проверить ноль строк.
    expect(sites.length).toBeGreaterThan(20);
  });

  it('скобки сбалансированы', () => {
    const broken = sites
      .filter(site => parenBalance(site.sql) !== 0)
      .map(site => `${site.file}: ${site.sql.trim().slice(0, 120).replace(/\s+/g, ' ')}…`);

    expect(broken).toEqual([]);
  });

  it('плейсхолдеры идут подряд без пропусков', () => {
    const gapped = sites
      .filter(site => placeholderGaps(site.sql).length > 0)
      .map(
        site =>
          `${site.file}: пропущены ${placeholderGaps(site.sql).join(', ')} — ` +
          `${site.sql.trim().slice(0, 120).replace(/\s+/g, ' ')}…`,
      );

    expect(gapped).toEqual([]);
  });
});

describe('детекторы сами по себе', () => {
  it('ловят незакрытую скобку — ровно тот баг, из-за которого тест появился', () => {
    const buggy = `UPDATE projects SET stage = $2
       WHERE id = $1 AND ($3 OR coalesce(CASE stage WHEN 'unknown' THEN 0 END, 0) < $4`;
    expect(parenBalance(buggy)).not.toBe(0);
  });

  it('не считают скобки внутри строк и комментариев', () => {
    const fine = `SELECT '((' AS a -- скобка ) в комментарии
                  FROM t WHERE x = $1`;
    expect(parenBalance(fine)).toBe(0);
  });

  it('ловят пропущенный плейсхолдер', () => {
    expect(placeholderGaps('SELECT * FROM t WHERE a = $1 AND b = $3')).toEqual([2]);
  });

  it('видят плейсхолдер внутри подставленной константы', () => {
    // Ровно тот случай, из-за которого появилась подстановка: $1 живёт
    // в общем CTE, а запрос вокруг него использует $2 и $3.
    const source = 'const CTE = `x AS (SELECT * FROM e WHERE v = $1)`;';
    const constants = collectTemplateConstants(source);
    const query = inlineConstants('WITH ${CTE} SELECT * FROM x WHERE a = $2 AND b = $3', constants);
    expect(placeholderGaps(query)).toEqual([]);
  });

  it('незнакомую подстановку оставляют как есть', () => {
    // Локальная переменная вроде ${orderBy} не шаблонная константа — её
    // значение статически неизвестно, и выдумывать его нельзя.
    expect(inlineConstants('ORDER BY ${orderBy}', new Map())).toBe('ORDER BY ${orderBy}');
  });
});
