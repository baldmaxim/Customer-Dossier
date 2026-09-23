import { describe, expect, it } from 'vitest';

import { likePattern } from './revisions.routes.js';

describe('likePattern — поиск по публикациям', () => {
  it('ищет подстроку в любом месте текста', () => {
    expect(likePattern('А101')).toBe('%А101%');
  });

  it('%, _ и обратная косая из запроса — буквы, а не шаблон: «50%» не находит всё подряд', () => {
    expect(likePattern('50%')).toBe(String.raw`%50\%%`);
    expect(likePattern('ЖК_2')).toBe(String.raw`%ЖК\_2%`);
    expect(likePattern(String.raw`a\b`)).toBe(String.raw`%a\\b%`);
  });
});
