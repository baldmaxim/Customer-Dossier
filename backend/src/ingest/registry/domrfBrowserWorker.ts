// Фоновое чтение наш.дом.рф через настоящий браузер Playwright (этапы 20C, 20D).
// Внешний сайт читается только из DOM открытой страницы, без его API. Открываются карточки объектов,
// подтверждённые оператором, и страницы их застройщика и группы в едином реестре застройщиков —
// по ссылкам самих карточек. Каталог не обходится: объекты со страниц застройщика и группы
// становятся кандидатами и ждут решения оператора (domrfCandidates.ts).

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright';

import { withTransaction } from '../../db/pool.js';
import { evaluateSourcePolicy } from '../policy.js';
import { getSourceByKey, type ISource } from '../sources.js';
import { type IDomRfBrowserCapture } from './browserCapture.js';
import { upsertDomRfCandidates } from './domrfCandidates.js';
import {
  DOMRF_HOST,
  claimDueDomRfCard,
  developerFromRow,
  developerIdentity,
  domRfCardUrl,
  ensureDomRfCard,
  failDomRfCard,
  getDomRfCard,
  isFreshCard,
  parseDomRfCardCapture,
  saveScannedDomRfCard,
  type DomRfCardKind,
  type IDomRfCardCapture,
  type IDomRfCardRow,
  type IDomRfDeveloperIdentity,
} from './domrfCards.js';
import {
  claimDomRfTarget,
  failDomRfTarget,
  parseDomRfObjectUrl,
  requestRecaptureForDeveloper,
  setDomRfTargetRefs,
  type IDomRfTarget,
} from './domrfTargets.js';
import { importRegistryPayload } from './importFile.js';

const script = (name: string): string => fs.readFileSync(fileURLToPath(new URL(`../../../scripts/${name}`, import.meta.url)), 'utf8');

/** «Показать ещё» добавляет объекты порциями: 60 нажатий хватает на несколько сотен домов группы. */
const MORE_CLICKS_MAX = 60;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const launchBrowser = async (): Promise<Browser> => {
  // Сайт возвращает 403 фоновому Chromium. Браузер с окном проходит: дома — свёрнутое окно, на сервере —
  // виртуальный экран Xvfb (deploy/Dockerfile.domrf). От root Chromium без --no-sandbox не стартует.
  const args = ['--start-minimized', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])];
  try {
    return await chromium.launch({ channel: 'chrome', headless: false, args });
  } catch {
    return chromium.launch({ headless: false, args });
  }
};

/** Один браузер на один проход: карточка объекта и страница её застройщика открываются в одном окне. */
const withPage = async <T>(fn: (page: Page) => Promise<T>): Promise<T> => {
  const browser = await launchBrowser();
  try {
    return await fn(await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } }));
  } finally {
    await browser.close();
  }
};

const open = async (page: Page, url: string): Promise<void> => {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (response?.status() !== 200) throw new Error(`страница ДОМ.РФ ответила HTTP ${response?.status() ?? 'без ответа'}`);
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 30_000 });
};

const captureObject = async (page: Page, target: Pick<IDomRfTarget, 'url' | 'externalRef'>): Promise<IDomRfBrowserCapture> => {
  await open(page, target.url);
  await page.getByRole('button', { name: 'Все характеристики' }).click({ timeout: 20_000 });
  await page.getByText('Количество квартир', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
  const capture = (await page.evaluate(script('domrf-browser-capture.js'))) as IDomRfBrowserCapture;
  if (parseDomRfObjectUrl(capture.url).externalRef !== target.externalRef) throw new Error('открылась другая карточка объекта');
  if (!capture.contractor) throw new Error('на странице не найден генподрядчик; снимок не сохранён');
  return capture;
};

export const captureDomRfWithPlaywright = (target: Pick<IDomRfTarget, 'url' | 'externalRef'>): Promise<IDomRfBrowserCapture> =>
  withPage(page => captureObject(page, target));

/** Страница застройщика или группы: весь список объектов раскрывается до чтения. */
const scanCardPage = async (page: Page, kind: DomRfCardKind, externalRef: string): Promise<IDomRfCardCapture> => {
  await open(page, domRfCardUrl(kind, externalRef));
  await page.waitForTimeout(2000); // список объектов приходит после заголовка
  for (let i = 0; i < MORE_CLICKS_MAX; i += 1) {
    const more = page.getByRole('button', { name: /Показать ещё/ }).first();
    if (!(await more.count()) || !(await more.isVisible())) break;
    await more.click({ timeout: 10_000 });
    await page.waitForTimeout(1500);
  }
  const card = parseDomRfCardCapture(await page.evaluate(script('domrf-card-capture.js')));
  if (card.kind !== kind || card.externalRef !== externalRef) throw new Error('открылась другая страница реестра застройщиков');
  return card;
};

const approvedSource = async (): Promise<ISource> => {
  const source = await getSourceByKey('website', DOMRF_HOST);
  if (!source) throw new Error('источник наш.дом.рф не зарегистрирован');
  const policy = evaluateSourcePolicy(source, 'collect');
  if (!policy.allowed) throw new Error(policy.reason ?? 'сбор источника не разрешён');
  return source;
};

/**
 * Прочитанная страница: застройщик — отдельным снимком реестра (компания с ИНН и ОГРН и её группа
 * публикуются общим путём), объекты из списка — в кандидаты, группа застройщика — в очередь чтения.
 */
const storeCard = async (source: ISource, card: IDomRfCardCapture): Promise<{ developer: IDomRfDeveloperIdentity | null; candidates: number }> => {
  const developer = developerIdentity(card);
  if (developer) {
    const imported = await importRegistryPayload(source, card);
    if (imported.kind !== 'stored') throw new Error(`снимок застройщика не сохранён: ${'message' in imported ? imported.message : imported.kind}`);
    if (imported.publishError) throw new Error(`снимок застройщика сохранён, но компания не обновлена: ${imported.publishError}`);
  }
  const candidates = await withTransaction(async client => {
    await saveScannedDomRfCard(client, card);
    return upsertDomRfCandidates(client, card);
  });
  if (card.kind === 'developer' && card.groupRef) await ensureDomRfCard('group', card.groupRef);
  return { developer, candidates };
};

/** Застройщик для снимка объекта: из свежей прочитанной страницы или прочитать её сейчас. */
const developerFor = async (page: Page, source: ISource, developerRef: string): Promise<IDomRfDeveloperIdentity | null> => {
  const known = await getDomRfCard('developer', developerRef);
  if (known && isFreshCard(known)) return developerFromRow(known);
  return (await storeCard(source, await scanCardPage(page, 'developer', developerRef))).developer;
};

export interface IDomRfPassResult {
  what: string;
  outcome: string;
}

const captureTarget = async (target: IDomRfTarget): Promise<IDomRfPassResult> => {
  const what = `объект ${target.externalRef}`;
  try {
    const source = await approvedSource();
    return await withPage(async page => {
      const capture = await captureObject(page, target);
      let developer: IDomRfDeveloperIdentity | null = null;
      let note = '';
      if (capture.developerRef) {
        // Страница застройщика не открылась — объект всё равно сохраняется; реквизиты придут
        // со следующим чтением застройщика (requestRecaptureForDeveloper).
        try {
          developer = await developerFor(page, source, capture.developerRef);
        } catch (err) {
          await ensureDomRfCard('developer', capture.developerRef);
          note = `; страница застройщика не прочитана: ${message(err)}`;
        }
      }
      if (capture.groupRef) await ensureDomRfCard('group', capture.groupRef);
      const result = await importRegistryPayload(source, capture, { projectId: target.projectId ?? undefined, developerCard: developer });
      if (result.kind !== 'stored') throw new Error(result.kind === 'invalid_page' || result.kind === 'config_invalid' ? result.message : `импорт не выполнен: ${result.kind}`);
      if (result.publishError) throw new Error(`снимок сохранён, но карточка не обновлена: ${result.publishError}`);
      await setDomRfTargetRefs(target.externalRef, capture.developerRef ?? null, capture.groupRef ?? null);
      return { what, outcome: `${result.outcome}${developer ? ', застройщик с реквизитами' : ''}${note}` };
    });
  } catch (err) {
    await failDomRfTarget(target.id, message(err), target.attemptCount + 1);
    return { what, outcome: `ошибка: ${message(err)}` };
  }
};

const scanDueCard = async (card: IDomRfCardRow): Promise<IDomRfPassResult> => {
  const what = `${card.kind === 'developer' ? 'застройщик' : 'группа'} ${card.externalRef}`;
  try {
    const source = await approvedSource();
    const scanned = await withPage(page => scanCardPage(page, card.kind, card.externalRef));
    const stored = await storeCard(source, scanned);
    const recaptured = stored.developer ? await requestRecaptureForDeveloper(card.externalRef) : 0;
    return {
      what,
      outcome: `объектов в списке ${scanned.objects.length}, новых кандидатов ${stored.candidates}${recaptured ? `, объектов на повторный снимок ${recaptured}` : ''}`,
    };
  } catch (err) {
    await failDomRfCard(card.id, message(err), card.attemptCount + 1);
    return { what, outcome: `ошибка: ${message(err)}` };
  }
};

/** Один шаг: сначала подтверждённые оператором карточки объектов, затем страницы застройщиков и групп. */
export const runDomRfBrowserPass = async (): Promise<IDomRfPassResult | null> => {
  const target = await claimDomRfTarget();
  if (target) return captureTarget(target);
  const card = await claimDueDomRfCard();
  if (card) return scanDueCard(card);
  return null;
};

/** Один обработчик на сервер: база выдаёт отдельную аренду для каждого процесса. */
export const startDomRfBrowserWorker = (signal: AbortSignal): void => {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running || signal.aborted) return;
    running = true;
    try {
      const result = await runDomRfBrowserPass();
      if (result) console.log(`[domrf] ${result.what}: ${result.outcome}`);
    } catch (err) {
      console.error('[domrf] проход упал:', message(err));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 60_000);
  signal.addEventListener('abort', () => clearInterval(timer));
  void tick();
};
