import { vi } from 'vitest';

/**
 * Ширина окна для useMediaQuery: min-width-запросы (MQ) сравниваются с ней. Без этого jsdom
 * считается широким экраном (useMediaQuery без matchMedia отвечает «да»). Снимается
 * vi.unstubAllGlobals() в setup.ts после каждого теста.
 */
export const stubViewport = (width: number, height = 800): void => {
  vi.stubGlobal('matchMedia', (query: string) => {
    const minWidth = /min-width:\s*(\d+)px/.exec(query);
    const minHeight = /min-height:\s*(\d+)px/.exec(query);
    const matches = (minWidth ? width >= Number(minWidth[1]) : true) && (minHeight ? height >= Number(minHeight[1]) : true) && !/prefers-/.test(query);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
  });
};
