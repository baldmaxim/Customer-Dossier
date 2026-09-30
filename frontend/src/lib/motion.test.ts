// Движение из JS: без View Transitions и при prefers-reduced-motion — просто обновление.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { prefersReducedMotion, scrollBehavior, startViewTransition } from './motion';

const setReduced = (reduced: boolean): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce'), media: query }));
};

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
});

describe('motion', () => {
  it('без поддержки View Transitions обновление выполняется сразу', () => {
    const update = vi.fn();
    startViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('с поддержкой — обновление внутри перехода', () => {
    setReduced(false);
    const update = vi.fn();
    const start = vi.fn((cb: () => void) => {
      cb();
      return {};
    });
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
    startViewTransition(update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('prefers-reduced-motion — без перехода и без плавной прокрутки', () => {
    setReduced(true);
    const start = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
    const update = vi.fn();
    startViewTransition(update);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe('auto');
  });
});
