// R19: includeGrey=false действительно скрывает серые компании.

import { describe, it, expect } from 'vitest';

import { listSchema } from './contractors.routes.js';

describe('listSchema.includeGrey', () => {
  it('строка "false" — false (раньше z.coerce.boolean давал true)', () => {
    expect(listSchema.parse({ includeGrey: 'false' }).includeGrey).toBe(false);
    expect(listSchema.parse({ includeGrey: '0' }).includeGrey).toBe(false);
  });

  it('"true" и "1" — true', () => {
    expect(listSchema.parse({ includeGrey: 'true' }).includeGrey).toBe(true);
    expect(listSchema.parse({ includeGrey: '1' }).includeGrey).toBe(true);
  });

  it('по умолчанию серые скрыты', () => {
    expect(listSchema.parse({}).includeGrey).toBe(false);
  });

  it('мусорное значение — ошибка разбора, а не true', () => {
    expect(listSchema.safeParse({ includeGrey: 'yes' }).success).toBe(false);
  });
});
