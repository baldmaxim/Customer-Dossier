// R19: includeInsufficient=false действительно скрывает серые компании.

import { describe, it, expect } from 'vitest';

import { listSchema } from './contractors.routes.js';

describe('listSchema.includeInsufficient', () => {
  it('строка "false" — false (раньше z.coerce.boolean давал true)', () => {
    expect(listSchema.parse({ includeInsufficient: 'false' }).includeInsufficient).toBe(false);
    expect(listSchema.parse({ includeInsufficient: '0' }).includeInsufficient).toBe(false);
  });

  it('"true" и "1" — true', () => {
    expect(listSchema.parse({ includeInsufficient: 'true' }).includeInsufficient).toBe(true);
    expect(listSchema.parse({ includeInsufficient: '1' }).includeInsufficient).toBe(true);
  });

  it('по умолчанию компании без данных скрыты', () => {
    expect(listSchema.parse({}).includeInsufficient).toBe(false);
  });

  it('мусорное значение — ошибка разбора, а не true', () => {
    expect(listSchema.safeParse({ includeInsufficient: 'yes' }).success).toBe(false);
  });
});
