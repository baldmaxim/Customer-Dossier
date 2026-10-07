import { describe, expect, it } from 'vitest';

import { parseDomRfObjectUrl, retryDelayMinutes } from './domrfTargets.js';

describe('очередь браузерных карточек ДОМ.РФ', () => {
  it('принимает ссылку на объект и убирает параметры отслеживания', () => {
    const parsed = parseDomRfObjectUrl('https://наш.дом.рф/сервисы/каталог-новостроек/объект/62087?from=admin');
    expect(parsed.externalRef).toBe('62087');
    expect(parsed.url).not.toContain('?');
    expect(parseDomRfObjectUrl(parsed.url)).toEqual(parsed);
  });

  it('отвергает чужой хост и другие разделы сайта', () => {
    expect(() => parseDomRfObjectUrl('https://evil.example/сервисы/каталог-новостроек/объект/62087')).toThrow();
    expect(() => parseDomRfObjectUrl('https://наш.дом.рф/portal-kn/api/kn/objects/62087')).toThrow();
    expect(() => parseDomRfObjectUrl('http://наш.дом.рф/сервисы/каталог-новостроек/объект/62087')).toThrow();
  });

  it('повтор ошибки: паузы растут, с шестой неудачи — раз в сутки', () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMinutes)).toEqual([2, 4, 8, 16, 32]);
    expect(retryDelayMinutes(6)).toBe(24 * 60);
    expect(retryDelayMinutes(71)).toBe(24 * 60);
  });
});
