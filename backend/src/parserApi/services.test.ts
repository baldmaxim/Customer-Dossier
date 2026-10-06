// Тариф parser-api.com по сервисам: метод → сервис, набор → сервис, расход по сервисам, паузы после отказа.

import { describe, expect, it } from 'vitest';

import { methodsOfService, PARSER_API_SERVICES, serviceOf } from './client.js';
import { DATASET_SERVICE } from './datasets.js';
import { isServiceStop, pausedServices, pauseService, resumeService } from './servicePauses.js';
import { usageByService } from './store.js';

describe('сервисы тарифа', () => {
  it('сервис — первая часть пути метода, как в личном кабинете parser-api.com; проверка ключа — ГИР БО', () => {
    expect(PARSER_API_SERVICES).toEqual(['nalog_bo', 'nalog_pb', 'arbitr', 'fssp', 'fedresurs']);
    expect(serviceOf('kad_details')).toBe('arbitr');
    expect(serviceOf('fedresurs_message')).toBe('fedresurs');
    expect(methodsOfService('nalog_bo')).toEqual(['bo_search', 'bo_details', 'key_check']);
  });

  it('набор ходит только в свой сервис', () => {
    expect(serviceOf('bo_search')).toBe(DATASET_SERVICE.finance);
    expect(serviceOf('pb_org')).toBe(DATASET_SERVICE.tax);
    expect(serviceOf('kad_search')).toBe(DATASET_SERVICE.courts);
    expect(serviceOf('fssp_ur')).toBe(DATASET_SERVICE.fssp);
    expect(serviceOf('fedresurs_messages')).toBe(DATASET_SERVICE.bankruptcy);
  });

  it('расход складывается по сервисам; сервис без запросов — нулями, неизвестный метод не считается', () => {
    const usage = usageByService([
      { method: 'kad_search', day: 3, month: 30 },
      { method: 'kad_details', day: 10, month: 10 },
      { method: 'fssp_ur', day: 1, month: 5 },
      { method: 'old_method', day: 99, month: 99 },
    ]);
    expect(usage).toEqual({
      nalog_bo: { day: 0, month: 0 },
      nalog_pb: { day: 0, month: 0 },
      arbitr: { day: 13, month: 40 },
      fssp: { day: 1, month: 5 },
      fedresurs: { day: 0, month: 0 },
    });
  });

  it('пауза — после лимита или подписки, не после отказа ключа; проходит по сроку или снимается успехом', () => {
    expect(isServiceStop('monthly_limit')).toBe(true);
    expect(isServiceStop('key_rejected')).toBe(false);
    const t = Date.UTC(2026, 9, 6, 12);
    pauseService('arbitr', 'daily_limit', t);
    pauseService('fssp', 'key_rejected', t);
    expect([...pausedServices(t + 60_000).keys()]).toEqual(['arbitr']);
    expect(pausedServices(t + 4 * 60 * 60_000).size).toBe(0);
    pauseService('arbitr', 'monthly_limit', t);
    resumeService('arbitr');
    expect(pausedServices(t).size).toBe(0);
  });
});
