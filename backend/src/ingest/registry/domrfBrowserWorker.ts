// Фоновое чтение карточек наш.дом.рф через настоящий браузер Playwright.
// Внешний сайт читается только из DOM открытой страницы, без его API.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from 'playwright';

import { evaluateSourcePolicy } from '../policy.js';
import { getSourceByKey } from '../sources.js';
import { type IDomRfBrowserCapture } from './browserCapture.js';
import { claimDomRfTarget, failDomRfTarget, parseDomRfObjectUrl, type IDomRfTarget } from './domrfTargets.js';
import { importRegistryPayload } from './importFile.js';

const SOURCE_KEY = 'xn--80az8a.xn--d1aqf.xn--p1ai';
const captureScript = (): string => fs.readFileSync(fileURLToPath(new URL('../../../scripts/domrf-browser-capture.js', import.meta.url)), 'utf8');

const launchBrowser = async (): Promise<Browser> => {
  // Сайт возвращает 403 фоновому Chromium. Обычный Chrome с окном проходит,
  // поэтому браузер запускается свёрнутым и закрывается после одного снимка.
  try {
    return await chromium.launch({ channel: 'chrome', headless: false, args: ['--start-minimized'] });
  } catch {
    return chromium.launch({ headless: false, args: ['--start-minimized'] });
  }
};

export const captureDomRfWithPlaywright = async (target: Pick<IDomRfTarget, 'url' | 'externalRef'>): Promise<IDomRfBrowserCapture> => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ locale: 'ru-RU' });
    const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (response?.status() !== 200) throw new Error(`страница ДОМ.РФ ответила HTTP ${response?.status() ?? 'без ответа'}`);
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: 'Все характеристики' }).click({ timeout: 20_000 });
    await page.getByText('Количество квартир', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
    const capture = await page.evaluate(captureScript()) as IDomRfBrowserCapture;
    if (parseDomRfObjectUrl(capture.url).externalRef !== target.externalRef) throw new Error('открылась другая карточка объекта');
    if (!capture.contractor) throw new Error('на странице не найден генподрядчик; снимок не сохранён');
    return capture;
  } finally {
    await browser.close();
  }
};

export const runDomRfBrowserPass = async (): Promise<{ id: number; externalRef: string; outcome: string } | null> => {
  const target = await claimDomRfTarget();
  if (!target) return null;
  try {
    const source = await getSourceByKey('website', SOURCE_KEY);
    if (!source) throw new Error('источник наш.дом.рф не зарегистрирован');
    const policy = evaluateSourcePolicy(source, 'collect');
    if (!policy.allowed) throw new Error(policy.reason ?? 'сбор источника не разрешён');

    const capture = await captureDomRfWithPlaywright(target);
    const result = await importRegistryPayload(source, capture, { projectId: target.projectId ?? undefined });
    if (result.kind !== 'stored') throw new Error(result.kind === 'invalid_page' || result.kind === 'config_invalid' ? result.message : `импорт не выполнен: ${result.kind}`);
    if (result.publishError) throw new Error(`снимок сохранён, но карточка не обновлена: ${result.publishError}`);
    return { id: target.id, externalRef: target.externalRef, outcome: result.outcome };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failDomRfTarget(target.id, message, target.attemptCount + 1);
    return { id: target.id, externalRef: target.externalRef, outcome: `ошибка: ${message}` };
  }
};

/** Один обработчик на сервер: база выдаёт отдельную аренду для каждого процесса. */
export const startDomRfBrowserWorker = (signal: AbortSignal): void => {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running || signal.aborted) return;
    running = true;
    try {
      const result = await runDomRfBrowserPass();
      if (result) console.log(`[domrf] ${result.externalRef}: ${result.outcome}`);
    } catch (err) {
      console.error('[domrf] проход упал:', err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 60_000);
  signal.addEventListener('abort', () => clearInterval(timer));
  void tick();
};
