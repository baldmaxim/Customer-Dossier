// TC-074 (закрытие приёмки 09): разбор аргументов CLI миграций без базы.

import { describe, expect, it } from 'vitest';

import { DESTRUCTIVE_MIGRATIONS, listMigrationFiles, parseMigrateArgs } from './migrate.js';

describe('parseMigrateArgs', () => {
  it('без аргументов — обычное применение без destructive', () => {
    expect(parseMigrateArgs([])).toEqual({ dryRun: false, allowDestructive: false });
  });

  it('--dry и --allow-destructive распознаются', () => {
    expect(parseMigrateArgs(['--dry'])).toEqual({ dryRun: true, allowDestructive: false });
    expect(parseMigrateArgs(['--allow-destructive', '--dry'])).toEqual({ dryRun: true, allowDestructive: true });
  });

  it('--upto принимает номер миграции', () => {
    expect(parseMigrateArgs(['--upto', '9', '--allow-destructive'])).toEqual({ dryRun: false, allowDestructive: true, upto: 9 });
    expect(parseMigrateArgs(['--upto', '020']).upto).toBe(20);
  });

  it('некорректный --upto — ошибка, а не молчаливое «нечего применять»', () => {
    expect(() => parseMigrateArgs(['--upto'])).toThrow(/--upto/);
    expect(() => parseMigrateArgs(['--upto', 'abc'])).toThrow(/--upto/);
    expect(() => parseMigrateArgs(['--upto', '0'])).toThrow(/--upto/);
    expect(() => parseMigrateArgs(['--upto', '-3'])).toThrow(/--upto/);
    expect(() => parseMigrateArgs(['--upto', '9.5'])).toThrow(/--upto/);
    expect(() => parseMigrateArgs(['--upto', '9', '--upto', '10'])).toThrow(/дважды/);
  });

  it('неизвестный флаг (например опечатка --dry-run) — ошибка, а не применение миграций', () => {
    expect(() => parseMigrateArgs(['--dry-run'])).toThrow(/неизвестный аргумент/);
  });

  it('удаление сид-сайтов помечено destructive: молча из базы строки не исчезают', () => {
    expect(DESTRUCTIVE_MIGRATIONS['024_drop_unused_seed_sites.sql']).toMatch(/заготов/);
    expect(listMigrationFiles()).toContain('024_drop_unused_seed_sites.sql');
  });

  it('применённые миграции 001–020 на месте и нумерация без пропусков', () => {
    const files = listMigrationFiles();
    expect(files.slice(0, 20).map(f => f.slice(0, 3))).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(3, '0')));
  });
});
