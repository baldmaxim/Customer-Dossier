import { describe, expect, it } from 'vitest';

import { ttlCache } from './ttlCache.js';

describe('ttlCache', () => {
  const setup = (max = 10) => {
    let t = 0;
    const calls: string[] = [];
    const cache = ttlCache(
      async (key: string) => {
        calls.push(key);
        if (key === 'сбой') throw new Error('сбой базы');
        return { key, n: calls.length };
      },
      { ttlMs: 1000, max, keyOf: k => k, now: () => t },
    );
    return { cache, calls, tick: (ms: number) => (t += ms) };
  };

  it('в пределах срока — из памяти, после срока — заново', async () => {
    const { cache, calls, tick } = setup();
    const first = await cache.get('a');
    tick(999);
    expect(await cache.get('a')).toBe(first);
    tick(1);
    expect(await cache.get('a')).not.toBe(first);
    expect(calls).toEqual(['a', 'a']);
  });

  it('clear() — сразу заново', async () => {
    const { cache, calls } = setup();
    await cache.get('a');
    cache.clear();
    await cache.get('a');
    expect(calls).toEqual(['a', 'a']);
  });

  it('ошибка не запоминается', async () => {
    const { cache, calls } = setup();
    await expect(cache.get('сбой')).rejects.toThrow('сбой базы');
    await expect(cache.get('сбой')).rejects.toThrow('сбой базы');
    expect(calls).toEqual(['сбой', 'сбой']);
  });

  it('не больше max записей: вытесняется самая старая', async () => {
    const { cache, calls } = setup(2);
    await cache.get('a');
    await cache.get('b');
    await cache.get('c');
    await cache.get('b');
    await cache.get('a');
    expect(calls).toEqual(['a', 'b', 'c', 'a']);
  });
});
