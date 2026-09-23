import { describe, expect, it } from 'vitest';

import { keysetCursor, parseKeysetCursor } from './keysetCursor.js';

describe('keysetCursor', () => {
  it('время — ISO в UTC, а не Date.toString(): его разбирает PostgreSQL', () => {
    const cursor = keysetCursor(new Date('2026-09-23T07:00:00.123Z'), 42);
    expect(cursor).toBe('2026-09-23T07:00:00.123Z|42');
    expect(parseKeysetCursor(cursor)).toEqual(['2026-09-23T07:00:00.123Z', 42]);
  });

  it('неразборчивый курсор — как отсутствующий: лента начинается сначала, а не падает', () => {
    expect(parseKeysetCursor(undefined)).toEqual([null, null]);
    expect(parseKeysetCursor('Wed Sep 23 2026 GMT+0300 (Москва)|x')).toEqual([null, null]);
    expect(parseKeysetCursor('мусор')).toEqual([null, null]);
  });
});
