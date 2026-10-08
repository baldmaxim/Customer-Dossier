// Фоновое чтение наш.дом.рф через настоящий браузер Playwright (этапы 20C, 20D).
// Внешний сайт читается только из DOM открытой страницы, без его API. Открываются карточки объектов,
// подтверждённые оператором, страницы их застройщика и группы в едином реестре застройщиков — по ссылкам
// самих карточек, и поиск компаний портала в реестре застройщиков. Каталог объектов не обходится:
// найденное — предложения и кандидаты, которые ждут решения оператора (domrfCompanies.ts, domrfCandidates.ts).

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright';

import { withTransaction } from '../../db/pool.js';
import { evaluateSourcePolicy } from '../policy.js';
import { getSourceByKey, type ISource } from '../sources.js';
import { type IDomRfBrowserCapture } from './browserCapture.js';
import { autoConfirmLinkedDomRfCandidates, upsertDomRfCandidates } from './domrfCandidates.js';
import {
  claimDomRfCompanySearch,
  domRfSearchUrl,
  failDomRfCompanySearch,
  parseDomRfSearchCapture,
  saveDomRfCompanySearch,
  type IDomRfCompanyToSearch,
  type IDomRfSearchCapture,
} from './domrfCompanies.js';
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
  hadContractor,
  parseDomRfObjectUrl,
  releaseDomRfTarget,
  requestRecaptureForDeveloper,
  listCapturedDomRfTargets,
  setDomRfTargetRefs,
  type IDomRfTarget,
} from './domrfTargets.js';
import { importRegistryPayload } from './importFile.js';
import { groupSyncSignature, syncDomRfGroupRelations } from '../../registry/groupSync.js';
import { withdrawModelExtractionOnRegistry } from '../../registry/modelArtifacts.js';
import { PHOTO_MAX_WIDTH, hasPhoto, markNoPhoto, needsPhoto, photosEnabled, readPhotoMeta, savePhoto } from '../../registry/photos.js';

const script = (name: string): string => fs.readFileSync(fileURLToPath(new URL(`../../../scripts/${name}`, import.meta.url)), 'utf8');

/** «Показать ещё» добавляет объекты порциями: 60 нажатий хватает на несколько сотен домов группы. */
const MORE_CLICKS_MAX = 60;

/**
 * Поисков компаний за проход: браузер запускается один раз на серию, страница — не чаще раза в 4 секунды.
 * Три за минуту — около 16 часов на первый обход 2800 компаний, дальше — только новые и месячный пересмотр.
 */
const SEARCHES_PER_PASS = 3;
const PAGE_PAUSE_MS = 4000;

/**
 * Карточек объектов за проход — так же серией в одном окне (07.10.2026): по одной в минуту очередь из 4 400
 * карточек шла бы четверо суток. Следующая берётся, только пока серия короче OBJECTS_BUDGET_MS: страница
 * застройщика с «Показать ещё» бывает длинной, а проход идёт раз в минуту.
 */
const OBJECTS_PER_PASS = 3;
const OBJECTS_BUDGET_MS = 40_000;

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

/**
 * Сайт не пустил браузер: ответа нет вовсе или пришла пустая страница проверки Servicepipe (без заголовка и текста,
 * cookie rndcaptcha). Так было 08.10.2026 с утра: каждая карточка падала по тайм-ауту. Капчу не обходим — ждём.
 */
export class DomRfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomRfUnavailableError';
  }
}

/** Пауза всего работника, пока сайт не пускает: 15 мин, затем вдвое, не дольше 2 ч; удачная страница её снимает. */
const BLOCK_PAUSE_MIN_MS = 15 * 60_000;
const BLOCK_PAUSE_MAX_MS = 2 * 60 * 60_000;
let blockPauseMs = 0;
let pausedUntil = 0;

const siteBlocked = (reason: string): DomRfUnavailableError => {
  blockPauseMs = Math.min(BLOCK_PAUSE_MAX_MS, blockPauseMs ? blockPauseMs * 2 : BLOCK_PAUSE_MIN_MS);
  pausedUntil = Date.now() + blockPauseMs;
  return new DomRfUnavailableError(`сайт не открыл страницу (${reason}); работник ждёт ${Math.round(blockPauseMs / 60_000)} мин`);
};

/** Вызов страницы для диагностики — с пределом: у page.evaluate своего тайм-аута нет, зависшая вкладка держала бы проход. */
const settleWithin = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([promise.catch(() => fallback), new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);

/** Пустая страница — проверка защиты, а не карточка. */
const isBlankPage = async (page: Page): Promise<boolean> =>
  !(await settleWithin(page.evaluate<boolean>('Boolean(document.title.trim() || document.body?.innerText.trim())'), 5_000, false));

const open = async (page: Page, url: string): Promise<void> => {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw siteBlocked('нет ответа 45 с');
    throw err;
  }
  if (response?.status() !== 200) throw new Error(`страница ДОМ.РФ ответила HTTP ${response?.status() ?? 'без ответа'}`);
  try {
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: 30_000 });
  } catch (err) {
    if (await isBlankPage(page)) throw siteBlocked('пустая страница проверки');
    throw err;
  }
  blockPauseMs = 0;
};

/** Подписи характеристик на странице — без значений: причина ошибки видна в админке «Карточки». */
const CHARACTERISTIC_LABELS = `[...document.querySelectorAll('[class*="CharacteristicsBlock__Row"] [class*="__Name"]')]
  .map(element => element.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 12)`;

const captureObject = async (page: Page, target: Pick<IDomRfTarget, 'url' | 'externalRef'>): Promise<IDomRfBrowserCapture> => {
  await open(page, target.url);
  await page.getByRole('button', { name: 'Все характеристики' }).click({ timeout: 20_000 });
  try {
    await page.getByText('Количество квартир', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    const labels = await settleWithin(page.evaluate<string[]>(CHARACTERISTIC_LABELS), 5_000, []);
    throw new Error(`нет строки «Количество квартир»; характеристики на странице: ${labels.length ? labels.join(', ') : 'не найдены'}`);
  }
  // Строка генподрядчика бывает ниже характеристик и приходит позже; у многих сданных домов её нет вовсе.
  await page.getByText(/^Генподрядчики:/).first().waitFor({ state: 'attached', timeout: 5_000 }).catch(() => undefined);
  const capture = (await page.evaluate(script('domrf-browser-capture.js'))) as IDomRfBrowserCapture;
  if (parseDomRfObjectUrl(capture.url).externalRef !== target.externalRef) throw new Error('открылась другая карточка объекта');
  if (!capture.contractor && await hadContractor(target.externalRef)) {
    throw new Error('генподрядчик пропал со страницы; снимок не сохранён');
  }
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
    // Сняли с чтения, пока браузер читал (выбрана другая запись): объекты страницы в «Объекты» не идут.
    if (await saveScannedDomRfCard(client, card)) return 0;
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

/** Адрес главного снимка галереи; нет галереи — null. */
const MAIN_PHOTO_SRC = `(() => {
  const img = document.querySelector('img[class*="GalleryAlamics__Image"]');
  return img ? (img.currentSrc || img.src) : null;
})()`;

/**
 * Главный снимок объекта — файлом (ADR-012 п. 35). Тот же исходник, что в прошлый раз, повторно не
 * скачивается. Сбой — пометка в итоге шага, а не ошибка снимка объекта: сведения важнее картинки.
 */
const capturePhoto = async (page: Page, externalRef: string): Promise<string> => {
  if (!photosEnabled()) return '';
  try {
    const src = await page.evaluate<string | null>(MAIN_PHOTO_SRC);
    if (!src) {
      markNoPhoto(externalRef);
      return '; фото на странице нет';
    }
    if (readPhotoMeta(externalRef)?.originalUrl === src && hasPhoto(externalRef)) return '';
    const shot = await page.evaluate<{ base64: string; width: number; height: number }>(
      `(${script('domrf-photo-capture.js')})(${JSON.stringify(src)}, ${PHOTO_MAX_WIDTH})`,
    );
    savePhoto(externalRef, { bytes: Buffer.from(shot.base64, 'base64'), width: shot.width, height: shot.height, originalUrl: src });
    return '; фото снято';
  } catch (err) {
    return `; фото не снято: ${message(err)}`;
  }
};

/**
 * Добор фото у объекта, снятого раньше, чем появились фото: открыть карточку и снять только снимок — без
 * «Все характеристики», без застройщика и без новой редакции. Галерея грузится вместе с заголовком.
 */
const backfillPhoto = async (target: { externalRef: string; url: string }): Promise<IDomRfPassResult> => {
  const what = `фото объекта ${target.externalRef}`;
  try {
    await approvedSource();
    const note = await withPage(async page => {
      await open(page, target.url);
      await page.locator('img[class*="GalleryAlamics__Image"]').first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => undefined);
      return capturePhoto(page, target.externalRef);
    });
    return { what, outcome: note.replace(/^; /, '') || 'фото то же, что прежде' };
  } catch (err) {
    return { what, outcome: `ошибка: ${message(err)}` };
  }
};

/** Следующий объект без фото среди снятых; null — добирать нечего. */
const nextPhotoBackfill = async (): Promise<{ externalRef: string; url: string } | null> => {
  if (!photosEnabled()) return null;
  return (await listCapturedDomRfTargets()).find(t => needsPhoto(t.externalRef)) ?? null;
};

export interface IDomRfPassResult {
  what: string;
  outcome: string;
}

const captureOne = async (page: Page, source: ISource, target: IDomRfTarget): Promise<IDomRfPassResult> => {
  const what = `объект ${target.externalRef}`;
  try {
    const capture = await captureObject(page, target);
    let developer: IDomRfDeveloperIdentity | null = null;
    // Фото — с той же открытой карточки, до перехода на страницу застройщика.
    let note = await capturePhoto(page, target.externalRef);
    if (capture.developerRef) {
      // Страница застройщика не открылась — объект всё равно сохраняется; реквизиты придут
      // со следующим чтением застройщика (requestRecaptureForDeveloper).
      try {
        developer = await developerFor(page, source, capture.developerRef);
      } catch (err) {
        await ensureDomRfCard('developer', capture.developerRef);
        note += `; страница застройщика не прочитана: ${message(err)}`;
      }
    }
    if (capture.groupRef) await ensureDomRfCard('group', capture.groupRef);
    const result = await importRegistryPayload(source, capture, { projectId: target.projectId ?? undefined, developerCard: developer });
    if (result.kind !== 'stored') throw new Error(result.kind === 'invalid_page' || result.kind === 'config_invalid' ? result.message : `импорт не выполнен: ${result.kind}`);
    if (result.publishError) throw new Error(`снимок сохранён, но карточка не обновлена: ${result.publishError}`);
    await setDomRfTargetRefs(target.externalRef, capture.developerRef ?? null, capture.groupRef ?? null);
    return { what, outcome: `${result.outcome}${developer ? ', застройщик с реквизитами' : ''}${note}` };
  } catch (err) {
    if (err instanceof DomRfUnavailableError) await releaseDomRfTarget(target.id);
    else await failDomRfTarget(target.id, message(err), target.attemptCount + 1);
    return { what, outcome: `ошибка: ${message(err)}` };
  }
};

/** Серия карточек объектов в одном окне: до OBJECTS_PER_PASS, первая ошибка останавливает серию. */
const captureTargets = async (first: IDomRfTarget): Promise<IDomRfPassResult[]> => {
  const results: IDomRfPassResult[] = [];
  const startedAt = Date.now();
  let next: IDomRfTarget | null = first;
  try {
    const source = await approvedSource();
    await withPage(async page => {
      while (next) {
        const target: IDomRfTarget = next;
        next = null;
        const result = await captureOne(page, source, target);
        results.push(result);
        if (result.outcome.startsWith('ошибка:') || results.length >= OBJECTS_PER_PASS) return;
        if (Date.now() - startedAt >= OBJECTS_BUDGET_MS) return;
        await page.waitForTimeout(PAGE_PAUSE_MS);
        next = await claimDomRfTarget();
      }
    });
  } catch (err) {
    // Нет допуска, браузер не запустился или упал между карточками: взятая и не снятая — повтор с паузой.
    if (next) {
      const target: IDomRfTarget = next;
      await failDomRfTarget(target.id, message(err), target.attemptCount + 1);
      results.push({ what: `объект ${target.externalRef}`, outcome: `ошибка: ${message(err)}` });
    } else {
      results.push({ what: 'карточки объектов', outcome: `ошибка: ${message(err)}` });
    }
  }
  return results;
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

/** Выдача поиска; не пришла по адресу — запрос вводится в поле, как это сделал бы человек. */
const runSearch = async (page: Page, text: string): Promise<IDomRfSearchCapture> => {
  await open(page, domRfSearchUrl(text));
  await page.waitForTimeout(4000); // выдача приходит после заголовка
  const read = async (): Promise<IDomRfSearchCapture> => parseDomRfSearchCapture(await page.evaluate(script('domrf-search-capture.js')));
  const direct = await read();
  if (direct.results.length > 0) return direct;
  const input = page.getByPlaceholder(/ИНН, ОГРН/).first();
  if (!(await input.count())) return direct;
  await input.fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);
  return read();
};

const searchCompany = async (page: Page, company: IDomRfCompanyToSearch): Promise<IDomRfPassResult> => {
  const what = `компания «${company.name}»`;
  try {
    const search = await runSearch(page, company.query);
    const added = await saveDomRfCompanySearch(company, search);
    return { what, outcome: `${company.foundBy === 'inn' ? 'по ИНН' : 'по названию'}: найдено ${search.results.length}, новых предложений ${added}` };
  } catch (err) {
    await failDomRfCompanySearch(company.companyId, message(err), company.attemptCount);
    return { what, outcome: `ошибка: ${message(err)}` };
  }
};

/** Серия поисков в одном окне: до SEARCHES_PER_PASS компаний, первая ошибка останавливает серию. */
const searchCompanies = async (first: IDomRfCompanyToSearch): Promise<IDomRfPassResult[]> => {
  const results: IDomRfPassResult[] = [];
  let next: IDomRfCompanyToSearch | null = first;
  try {
    await withPage(async page => {
      while (next) {
        const company: IDomRfCompanyToSearch = next;
        next = null;
        const result = await searchCompany(page, company);
        results.push(result);
        if (result.outcome.startsWith('ошибка:') || results.length >= SEARCHES_PER_PASS) return;
        await page.waitForTimeout(PAGE_PAUSE_MS);
        next = await claimDomRfCompanySearch();
      }
    });
  } catch (err) {
    // Браузер не запустился или упал между поисками: взятая и не искавшаяся компания — повтор с паузой.
    if (next) await failDomRfCompanySearch(next.companyId, message(err), next.attemptCount);
    results.push({ what: 'поиск компаний', outcome: `ошибка: ${message(err)}` });
  }
  return results;
};

const sourceApproved = (): Promise<boolean> => approvedSource().then(
  () => true,
  () => false,
);

/**
 * Каждый PAGES_EVERY-й шаг страницы застройщиков и поиск идут раньше объектов: после «Это он» по
 * большой группе в очереди тысячи объектов, и без этого страницы и поиск стояли бы сутками.
 */
const PAGES_EVERY = 4;
let passNo = 0;
/** Синхронизация групп без смены данных — не чаще. */
const GROUP_SYNC_EVERY_MS = 10 * 60_000;
let groupSync = { signature: '', at: 0 };

/**
 * Один шаг: карточки объектов, страницы застройщиков и групп, серия поисков компаний портала в
 * реестре застройщиков. Поиск — фоновый обход без решения оператора: без допуска сбора компании не
 * берутся вовсе, иначе каждая получила бы ошибку. Перед шагом объекты подтверждённых оператором
 * страниц ставятся в сбор (ADR-012 п. 32).
 */
export const runDomRfBrowserPass = async (): Promise<IDomRfPassResult[]> => {
  const queued = await autoConfirmLinkedDomRfCandidates();
  const prefix: IDomRfPassResult[] = queued > 0 ? [{ what: 'объекты подтверждённых страниц', outcome: `в сбор поставлено ${queued}` }] : [];
  // Разбор моделью по снимкам реестра — не наш путь (ADR-012 п. 34): уже попавшее снимается.
  const extraction = await withdrawModelExtractionOnRegistry();
  if (extraction.evidence + extraction.runs > 0) {
    prefix.push({ what: 'разбор моделью по снимкам реестра', outcome: `снято доказательств ${extraction.evidence}, запусков ${extraction.runs}` });
  }
  // Связи «застройщик входит в группу» — к компании, подтверждённой для страницы группы (ADR-012 п. 33). Только при
  // смене данных или раз в GROUP_SYNC_EVERY_MS (registry/groupSync.ts, groupSyncSignature).
  const signature = await groupSyncSignature();
  if (signature !== groupSync.signature || Date.now() - groupSync.at >= GROUP_SYNC_EVERY_MS) {
    const groups = await syncDomRfGroupRelations();
    groupSync = { signature, at: Date.now() };
    if (groups.linked + groups.withdrawn > 0) {
      prefix.push({ what: 'связи с группами', outcome: `записано ${groups.linked}, снято ${groups.withdrawn}` });
    }
  }
  // Сайт не пускает браузер — работа с базой выше идёт, страницы не открываются до конца паузы.
  if (Date.now() < pausedUntil) return prefix;
  passNo += 1;
  // Каждый второй шаг (кроме шагов страниц застройщиков) — добор фото у снятых раньше объектов, пока такие есть.
  if (passNo % 2 === 1 && passNo % PAGES_EVERY !== 0) {
    const photo = await nextPhotoBackfill();
    if (photo) return [...prefix, await backfillPhoto(photo)];
  }
  const objectsFirst = passNo % PAGES_EVERY !== 0;
  if (objectsFirst) {
    const target = await claimDomRfTarget();
    if (target) return [...prefix, ...(await captureTargets(target))];
  }
  const card = await claimDueDomRfCard();
  if (card) return [...prefix, await scanDueCard(card)];
  const approved = await sourceApproved();
  const company = approved ? await claimDomRfCompanySearch() : null;
  if (company) return [...prefix, ...(await searchCompanies(company))];
  if (!objectsFirst) {
    const target = await claimDomRfTarget();
    if (target) return [...prefix, ...(await captureTargets(target))];
  }
  return prefix;
};

/**
 * Проход дольше этого — завис: после падения вкладки (Target crashed) или страницы проверки вызовы Playwright
 * без своего тайм-аута не возвращаются, и флаг running молча останавливал работника на часы (06–08.10.2026).
 * Самый длинный честный проход — три карточки со страницами застройщиков — укладывается в несколько минут.
 */
const PASS_HANG_MS = 15 * 60_000;

/**
 * Один обработчик на сервер: база выдаёт отдельную аренду для каждого процесса. onHang — что делать с зависшим
 * проходом: отдельный процесс работника выходит, и Docker его перезапускает; внутри API — только запись в лог.
 */
export const startDomRfBrowserWorker = (signal: AbortSignal, onHang?: () => void): void => {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running || signal.aborted) return;
    running = true;
    const watchdog = setTimeout(() => {
      console.error(`[domrf] проход идёт дольше ${PASS_HANG_MS / 60_000} мин — завис`);
      onHang?.();
    }, PASS_HANG_MS);
    try {
      for (const result of await runDomRfBrowserPass()) console.log(`[domrf] ${result.what}: ${result.outcome}`);
    } catch (err) {
      console.error('[domrf] проход упал:', message(err));
    } finally {
      clearTimeout(watchdog);
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 60_000);
  signal.addEventListener('abort', () => clearInterval(timer));
  void tick();
};
