// T10-05 / TC-078 (закрытие приёмки 09): ошибочный HTTP-ответ не становится временем успешного шага.

import { describe, expect, it } from 'vitest';

import type { ITestResponse } from '../__tests__/integration/http.js';
import { REQUIRED_STEPS, benchValidity, median, summarizeStep, validators, type ISample } from './bench.js';

const res = (status: number, body: Record<string, unknown>): ITestResponse => ({ status, headers: {}, body });
const ok: ISample = { ok: true, status: 200, detail: 'HTTP 200' };
const meta = { code: 'search', title: 'поиск', required: true };

describe('validators', () => {
  it('поиск: HTTP 400 (старый путь) — ошибка, а не быстрый успех', () => {
    const sample = validators.search(res(400, { error: 'Укажите параметр q длиной от 2 символов' }), 7);
    expect(sample).toMatchObject({ ok: false, status: 400 });
  });

  it('поиск: 200 без искомой компании — ошибка', () => {
    expect(validators.search(res(200, { items: [{ id: 8 }] }), 7).ok).toBe(false);
    expect(validators.search(res(200, {}), 7).ok).toBe(false);
    expect(validators.search(res(200, { items: [{ id: 8 }, { id: 7 }] }), 7).ok).toBe(true);
  });

  it('401 без входа — ошибка любого шага', () => {
    expect(validators.caseDossier(res(401, { error: 'нужен вход' }), 1).ok).toBe(false);
    expect(validators.snapshotRead(res(401, {}), 1).ok).toBe(false);
  });

  it('пустое досье и досье другого обращения — ошибка', () => {
    expect(validators.caseDossier(res(200, {}), 1).ok).toBe(false);
    expect(validators.caseDossier(res(200, { caseId: 2, role: {} }), 1).ok).toBe(false);
    expect(validators.caseDossier(res(200, { caseId: 1, role: { status: 'documented' } }), 1).ok).toBe(true);
  });

  it('снимок: неподтверждённый hash — ошибка; выгрузка должна быть HTML', () => {
    expect(validators.snapshotRead(res(200, { meta: { id: 3 }, integrity: { verified: false } }), 3).ok).toBe(false);
    expect(validators.snapshotRead(res(200, { meta: { id: 3 }, integrity: { verified: true } }), 3).ok).toBe(true);
    expect(validators.exportHtml(res(200, { raw: '' })).ok).toBe(false);
    expect(validators.exportHtml(res(200, { raw: `<!doctype html><html lang="ru">${'x'.repeat(300)}</html>` })).ok).toBe(true);
    expect(validators.snapshotCreate(res(200, { id: 5, payloadHash: 'h' })).ok).toBe(false);
  });

  it('карточка: сигналы с ошибкой делают шаг неуспешным', () => {
    expect(validators.companyCard(res(200, { company: { id: 7 } }), res(500, { error: 'x' }), 7).ok).toBe(false);
    expect(validators.companyCard(res(200, { mergedInto: 9 }), res(200, { a: 1 }), 7).ok).toBe(false);
  });
});

describe('summarizeStep', () => {
  it('время ошибочных выборок не входит в статистику', () => {
    const bad: ISample = { ok: false, status: 400, detail: 'ожидался HTTP 200, получен 400' };
    const step = summarizeStep(meta, ok, [
      { sample: bad, ms: 1 },
      { sample: ok, ms: 20 },
      { sample: ok, ms: 40 },
    ]);
    expect(step).toMatchObject({ successes: 2, requested: 3, min: 20, median: 30, max: 40, status: 'partial' });
    expect(step.errors).toEqual([bad]);
  });

  it('нет успешных выборок — нет медианы (не 0) и статус failed', () => {
    const bad: ISample = { ok: false, status: 400, detail: 'x' };
    const step = summarizeStep(meta, bad, [{ sample: bad, ms: 1 }]);
    expect(step).toMatchObject({ successes: 0, min: null, median: null, max: null, status: 'failed' });
    expect(median([])).toBeNull();
  });

  it('ошибка прогрева видна и не маскируется успешными замерами', () => {
    const warm: ISample = { ok: false, status: 500, detail: 'прогрев упал' };
    const step = summarizeStep(meta, warm, [{ sample: ok, ms: 10 }]);
    expect(step.status).toBe('partial');
    expect(step.warmup).toEqual(warm);
  });
});

describe('benchValidity', () => {
  const step = (code: string, status: 'ok' | 'failed') => summarizeStep({ code, title: code, required: true }, ok, [{ sample: status === 'ok' ? ok : { ok: false, status: 400, detail: 'x' }, ms: 5 }]);

  it('обязательный шаг без успеха делает отчёт недействительным', () => {
    const steps = REQUIRED_STEPS.map(c => step(c, c === 'search' ? 'failed' : 'ok'));
    const v = benchValidity(steps, REQUIRED_STEPS, []);
    expect(v.valid).toBe(false);
    expect(v.reasons[0]).toMatch(/search/);
  });

  it('пропущенный обязательный шаг и отсутствие данных — недействительно', () => {
    expect(benchValidity([], REQUIRED_STEPS, []).valid).toBe(false);
    expect(benchValidity([], [], ['в базе нет обращения']).valid).toBe(false);
  });

  it('все обязательные шаги успешны — действительно', () => {
    expect(benchValidity(REQUIRED_STEPS.map(c => step(c, 'ok')), REQUIRED_STEPS, [])).toEqual({ valid: true, reasons: [] });
  });
});
