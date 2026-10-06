// Карта ГИР БО без сети (этап 24B, T24B-01): форма — как в живом ответе 06.10.2026, числа — синтетические.

import { describe, expect, it } from 'vitest';

import type { IDatasetPayload } from '../datasets.js';
import { mapFinance } from './finance.js';

const INN = '7736255508';

const report = (period: number, over: Record<string, unknown> = {}, lines: Record<number, number> = {}) => ({
  period: String(period),
  correction_number: 0,
  published_date: `${period + 1}-04-01`,
  actual_bfo_date: `${period + 1}-03-30`,
  audit_report: null,
  url: `https://bo.nalog.gov.ru/download/bfo/pdf/${period}`,
  balance: [
    { code: 1600, name: 'Баланс (актив)', current: lines[1600] ?? 1000, previous: 900 },
    { code: 1300, name: 'Итого по разделу III', current: lines[1300] ?? 400, previous: 380 },
    { code: 1410, name: 'Заемные средства', current: 300, previous: 280 },
  ],
  financial_result: [
    { code: 2110, name: 'Выручка', current: lines[2110] ?? 500, previous: 450 },
    { code: 2400, name: 'Чистая прибыль (убыток)', current: lines[2400] ?? 50, previous: 40 },
    { code: 2330, name: 'Проценты к уплате', current: lines[2330] ?? -20, previous: -18 },
  ],
  ...over,
});

const payload = (reports: unknown[]): IDatasetPayload => ({
  format: 'parser-api-dataset@1',
  dataset: 'finance',
  inn: INN,
  window: null,
  missing: [],
  responses: [
    { method: 'bo_search', params: { inn: INN }, body: { success: 1, items: [{ id: 1, inn: INN }] } },
    { method: 'bo_details', params: { id: '1' }, body: { success: 1, organization: { inn: INN }, reports } },
  ],
});

describe('карта ГИР БО (T24B-01)', () => {
  it('тысячи рублей → рубли, годы по убыванию, нет строки — null, а не ноль', () => {
    const view = mapFinance(payload([report(2023), report(2024)]));
    expect(view.recognized).toBe(true);
    expect(view.years.map(y => y.year)).toEqual([2024, 2023]);
    expect(view.years[0]).toMatchObject({ revenue: 500_000, assets: 1_000_000, equity: 400_000, longBorrowings: 300_000, netProfit: 50_000, cash: null });
  });

  it('год — из собственного отчёта: пересчёт в следующем отчёте (previous) его не подменяет', () => {
    const view = mapFinance(payload([report(2024, {}, { 1600: 1000 }), report(2023, {}, { 1600: 777 })]));
    expect(view.years.find(y => y.year === 2023)!.assets).toBe(777_000);
  });

  it('несколько отчётов за год — наибольшая поправка', () => {
    const view = mapFinance(
      payload([report(2022, { correction_number: 1 }, { 2110: 100 }), report(2022, { correction_number: 3 }, { 2110: 300 }), report(2022, { correction_number: 2 }, { 2110: 200 })]),
    );
    expect(view.years).toHaveLength(1);
    expect(view.years[0]).toMatchObject({ revenue: 300_000, source: { correctionNumber: 3 } });
  });

  it('проценты к уплате — по модулю (знак в ГИР БО непостоянен), убыток — со знаком', () => {
    const view = mapFinance(payload([report(2025, {}, { 2330: 20, 2400: -70 }), report(2024, {}, { 2330: -20 })]));
    expect(view.years.map(y => y.interestPayable)).toEqual([20_000, 20_000]);
    expect(view.years[0]!.netProfit).toBe(-70_000);
  });

  it('аудит и ссылка на PDF; чужой адрес ссылки не берётся', () => {
    const view = mapFinance(payload([report(2025, { audit_report: { file_url: 'x' } }), report(2024, { url: 'https://evil.example/x.pdf' })]));
    expect(view.years[0]!.source).toMatchObject({ audited: true, pdfUrl: 'https://bo.nalog.gov.ru/download/bfo/pdf/2025' });
    expect(view.years[1]!.source).toMatchObject({ audited: false, pdfUrl: null });
  });

  it('незнакомая форма — не распознано с причиной, а не пустые годы', () => {
    const noDetails: IDatasetPayload = { ...payload([]), responses: [] };
    expect(mapFinance(noDetails)).toMatchObject({ recognized: false, years: [] });
    expect(mapFinance(noDetails).problems[0]).toMatch(/bo_details/);
    const noReports = payload([]);
    noReports.responses[1]!.body = { success: 1 };
    expect(mapFinance(noReports).problems[0]).toMatch(/reports/);
  });
});
