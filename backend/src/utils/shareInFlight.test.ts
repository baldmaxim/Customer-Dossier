import { describe, expect, it } from 'vitest';

import { shareInFlight } from './shareInFlight.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('shareInFlight', () => {
  it('одновременные вызовы с одним ключом — один расчёт; другой ключ считается отдельно', async () => {
    const calls: number[] = [];
    const gate = deferred<void>();
    const load = shareInFlight(async (id: number) => {
      calls.push(id);
      await gate.promise;
      return { id };
    });
    const a = load(1);
    const b = load(1);
    const c = load(2);
    gate.resolve();
    expect(await a).toBe(await b);
    expect(await c).toEqual({ id: 2 });
    expect(calls).toEqual([1, 2]);
  });

  it('после завершения запись снимается: следующий вызов считает заново (кэша нет)', async () => {
    let n = 0;
    const load = shareInFlight(async (_id: number) => ++n);
    expect(await load(1)).toBe(1);
    expect(await load(1)).toBe(2);
  });

  it('ошибка доходит до всех ждавших и не залипает', async () => {
    const gate = deferred<number>();
    let attempts = 0;
    const load = shareInFlight((_id: number) => {
      attempts += 1;
      return attempts === 1 ? gate.promise : Promise.resolve(7);
    });
    const a = load(1);
    const b = load(1);
    gate.reject(new Error('сбой базы'));
    await expect(a).rejects.toThrow('сбой базы');
    await expect(b).rejects.toThrow('сбой базы');
    expect(await load(1)).toBe(7);
  });
});
