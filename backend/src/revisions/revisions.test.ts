// Чистая логика этапа 02: личность публикации, решение о редакции, diff.
// Сценарии с базой (TC-011…TC-018) — revisions.int.test.ts.

import { describe, it, expect } from 'vitest';

import { decideRevision, type ILatestState } from './decide.js';
import { diffLines } from './diff.js';
import { canonicalRevisionText, canonicalizeUrl, itemIdentity, revisionHash } from './identity.js';

describe('canonicalizeUrl (TC-017)', () => {
  it('убирает только известные tracking-параметры и фрагмент', () => {
    expect(canonicalizeUrl('HTTPS://Example.RU:443/news/1?utm_source=tg&id=5&fbclid=x#top')).toBe(
      'https://example.ru/news/1?id=5',
    );
  });

  it('содержательные параметры сохраняются: разные статьи не склеиваются', () => {
    const a = canonicalizeUrl('https://example.ru/article.php?id=100');
    const b = canonicalizeUrl('https://example.ru/article.php?id=101');
    expect(a).not.toBe(b);
    expect(canonicalizeUrl('https://example.ru/list?page=2')).toBe('https://example.ru/list?page=2');
  });

  it('путь и завершающий слеш не трогаются', () => {
    expect(canonicalizeUrl('https://example.ru/a/')).toBe('https://example.ru/a/');
    expect(canonicalizeUrl('https://example.ru/a')).toBe('https://example.ru/a');
  });

  it('не http(s) и мусор — null', () => {
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalizeUrl('не адрес')).toBeNull();
  });
});

describe('itemIdentity', () => {
  it('внешний id — ключ публикации, текст на личность не влияет', () => {
    const a = itemIdentity({ externalId: 'channel/12', url: 'https://t.me/channel/12', body: 'версия А' });
    const b = itemIdentity({ externalId: 'channel/12', url: 'https://t.me/channel/12', body: 'версия Б' });
    expect(a.key).toBe('ext:channel/12');
    expect(b.key).toBe(a.key);
  });

  it('guid-URL и адрес статьи дают канонический URL', () => {
    const id = itemIdentity({ externalId: 'https://example.ru/n/1?utm_medium=rss', url: null, body: 'x' });
    expect(id).toMatchObject({ kind: 'canonical_url', key: 'url:https://example.ru/n/1' });
  });

  it('без id и адреса — хэш текста', () => {
    const id = itemIdentity({ externalId: null, url: null, body: 'ручная вставка' });
    expect(id.kind).toBe('text_hash');
    expect(id.key).toMatch(/^text:[0-9a-f]{64}$/);
  });

  it('одинаковый текст в разных источниках — одинаковый ключ, но личность = (источник, ключ) (TC-015)', () => {
    // Ключ одинаков, а уникальность в БД — (source_id, item_key): две публикации.
    const a = itemIdentity({ externalId: null, url: null, body: 'один текст' });
    const b = itemIdentity({ externalId: null, url: null, body: 'один текст' });
    expect(a.key).toBe(b.key);
  });
});

describe('canonicalRevisionText / revisionHash', () => {
  it('переводы строк, хвостовые пробелы и NFC не создают новую редакцию', () => {
    expect(revisionHash('Строка  \r\nвторая\t\n')).toEqual(revisionHash('Строка\nвторая'));
    expect(revisionHash('é')).toEqual(revisionHash('é'));
  });

  it('изменение символа внутри текста — другой хэш', () => {
    expect(revisionHash('Срок сдачи — 2026')).not.toEqual(revisionHash('Срок сдачи — 2027'));
    expect(revisionHash('два  пробела')).not.toEqual(revisionHash('два пробела'));
  });

  it('каноническая форма не трогает внутренние пробелы и пустые строки абзацев', () => {
    expect(canonicalRevisionText('a\n\nb')).toBe('a\n\nb');
  });
});

const latest = (over: Partial<ILatestState> = {}): ILatestState => ({
  bodyHashHex: 'aaa',
  sourceModifiedAt: null,
  stateObservedAt: new Date('2026-09-10T10:00:00Z'),
  ...over,
});

describe('decideRevision', () => {
  const at = (iso: string): Date => new Date(iso);

  it('первое наблюдение — новая публикация', () => {
    expect(decideRevision(null, { bodyHashHex: 'aaa', sourceModifiedAt: null, fetchedAt: at('2026-09-10T10:00:00Z') }, false))
      .toMatchObject({ outcome: 'new_item', createsRevision: true, movesLatest: true, chronology: 'observed_order' });
  });

  it('повтор текущего текста — только наблюдение (TC-012)', () => {
    expect(
      decideRevision(latest(), { bodyHashHex: 'aaa', sourceModifiedAt: null, fetchedAt: at('2026-09-11T10:00:00Z') }, true),
    ).toMatchObject({ outcome: 'unchanged', createsRevision: false });
  });

  it('новый текст при том же id — новая редакция (TC-011)', () => {
    expect(
      decideRevision(latest(), { bodyHashHex: 'bbb', sourceModifiedAt: null, fetchedAt: at('2026-09-11T10:00:00Z') }, false),
    ).toMatchObject({ outcome: 'new_revision', createsRevision: true, movesLatest: true });
  });

  it('A → B → A: возврат к старому тексту — новая редакция, а не ссылка на первую (TC-013)', () => {
    const decision = decideRevision(
      latest({ bodyHashHex: 'bbb' }),
      { bodyHashHex: 'aaa', sourceModifiedAt: null, fetchedAt: at('2026-09-12T10:00:00Z') },
      true,
    );
    expect(decision).toMatchObject({ outcome: 'new_revision', createsRevision: true, movesLatest: true });
  });

  it('исправление без даты: порядок — по наблюдению, дата изменения не выдумывается', () => {
    const decision = decideRevision(
      latest(),
      { bodyHashHex: 'bbb', sourceModifiedAt: null, fetchedAt: at('2026-09-11T10:00:00Z') },
      false,
    );
    expect(decision.chronology).toBe('observed_order');
  });

  it('запоздалое старое наблюдение не становится текущим состоянием', () => {
    const decision = decideRevision(
      latest({ stateObservedAt: at('2026-09-12T10:00:00Z') }),
      { bodyHashHex: 'old', sourceModifiedAt: null, fetchedAt: at('2026-09-11T09:00:00Z') },
      false,
    );
    expect(decision).toMatchObject({ outcome: 'stale', createsRevision: true, movesLatest: false, chronology: 'unknown' });
  });

  it('старая дата изменения от источника — stale с опорой на эту дату', () => {
    const decision = decideRevision(
      latest({ sourceModifiedAt: at('2026-09-12T00:00:00Z') }),
      { bodyHashHex: 'old', sourceModifiedAt: at('2026-09-01T00:00:00Z'), fetchedAt: at('2026-09-13T00:00:00Z') },
      true,
    );
    expect(decision).toMatchObject({ outcome: 'stale', createsRevision: false, movesLatest: false, chronology: 'source_modified_at' });
  });
});

describe('diffLines', () => {
  it('показывает удалённые и добавленные строки', () => {
    const result = diffLines('a\nb\nc', 'a\nB\nc');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inserted).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.ops).toEqual([
      { op: 'equal', lines: ['a'] },
      { op: 'delete', lines: ['b'] },
      { op: 'insert', lines: ['B'] },
      { op: 'equal', lines: ['c'] },
    ]);
  });

  it('длинные неизменные участки сворачиваются', () => {
    const base = Array.from({ length: 50 }, (_, i) => `строка ${i}`);
    const changed = [...base];
    changed[25] = 'правка';
    const result = diffLines(base.join('\n'), changed.join('\n'), { maxLines: 100, maxChars: 10_000, context: 2 });
    expect(result.ok && result.ops.some(op => op.op === 'skip')).toBe(true);
  });

  it('HTML в тексте — просто строки, ничего не интерпретируется', () => {
    const result = diffLines('<script>alert(1)</script>', '<img src=x onerror=alert(1)>');
    expect(result.ok && result.ops.map(o => o.op)).toEqual(['delete', 'insert']);
  });

  it('слишком большой текст — отказ с причиной, а не зависание', () => {
    const big = Array.from({ length: 30 }, () => 'x').join('\n');
    expect(diffLines(big, big, { maxLines: 10, maxChars: 1000, context: 1 })).toEqual({
      ok: false,
      reason: 'больше 10 строк',
    });
  });
});
