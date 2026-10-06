// Проверка кандидата в сайты компании без сети (этап 25A): страницы — фикстуры вместо запросов.
// Реквизит ищется на главной и на страницах «Контакты / О компании»; чужой ИНН виден отдельно;
// перенаправление на другой сайт, запрет и страница на одном JS — разные исходы, не «сайт проверен».

import { describe, expect, it } from 'vitest';

import type { SiteFetchResult } from '../ingest/sites/fetcher.js';
import { INN_A, INN_B } from '../reprocess/__fixtures__/extraction.js';
import { infoLinks, otherInnsIn, pageText, verifyCandidate, candidatePolicy, type PageFetcher } from './verify.js';

const OGRN = '1027700132239';

const ok = (text: string, finalUrl: string): SiteFetchResult => ({ kind: 'ok', status: 200, text, finalUrl, etag: null, lastModified: null });

const fetcher = (pages: Record<string, SiteFetchResult>): { fetch: PageFetcher; seen: string[] } => {
  const seen: string[] = [];
  return {
    seen,
    fetch: async url => {
      seen.push(url);
      return pages[url] ?? { kind: 'http', status: 404, retryAfterAt: null, message: 'HTTP 404' };
    },
  };
};

const HOME = `<html><head><title>Донстрой — квартиры в Москве</title><script>1</script></head><body>
  <nav><a href="/kontakty">Контакты</a> <a href="https://msk.donstroy.moscow/o-kompanii">О компании</a>
  <a href="https://other.ru/contacts">Контакты партнёра</a> <a href="/projects">Проекты</a> <a href="mailto:a@b.ru">Почта</a></nav>
  <main><h1>Жилые комплексы бизнес-класса</h1><p>Группа компаний ДОНСТРОЙ строит в Москве с 1994 года. Сдано более 100 домов, в продаже квартиры
  в комплексах на западе и юго-западе столицы, ключи выдаются по графику.</p></main>
  <footer>© 2026</footer></body></html>`;

const CONTACTS = `<html><body><footer>ООО «Донстрой Инвест»<br>ИНН${INN_A} ОГРН ${OGRN}<br>Генподрядчик: ИНН: ${INN_B}</footer></body></html>`;

const COMPANY = { name: 'Донстрой', inn: INN_A, ogrn: OGRN };

describe('проверка кандидата в сайты компании', () => {
  it('ИНН и ОГРН — на странице контактов, название — на главной; чужой ИНН виден отдельно', async () => {
    const f = fetcher({
      'https://donstroy.moscow/': ok(HOME, 'https://donstroy.moscow/'),
      'https://donstroy.moscow/kontakty': ok(CONTACTS, 'https://donstroy.moscow/kontakty'),
    });
    const check = await verifyCandidate('https://donstroy.moscow/', 'donstroy.moscow', COMPANY, f.fetch, 0);
    expect(check).toMatchObject({ status: 'ok', pageTitle: 'Донстрой — квартиры в Москве', innOnPage: true, ogrnOnPage: true, nameOnPage: true, otherInns: [INN_B], pagesRead: 2 });
    // Ссылки чужого хоста и mailto не открываются; страница без реквизитов в названии ссылки — тоже.
    expect(f.seen).toEqual(['https://donstroy.moscow/', 'https://donstroy.moscow/kontakty', 'https://msk.donstroy.moscow/o-kompanii']);
  });

  it('реквизита нет — признак false, а не «неизвестно»; у компании без ОГРН — null', async () => {
    const f = fetcher({ 'https://donstroy.moscow/': ok(HOME, 'https://donstroy.moscow/') });
    const check = await verifyCandidate('https://donstroy.moscow/', 'donstroy.moscow', { name: 'Альфа Девелопмент', inn: INN_A, ogrn: null }, f.fetch, 0);
    expect(check).toMatchObject({ status: 'ok', innOnPage: false, ogrnOnPage: null, nameOnPage: false, otherInns: [] });
  });

  it('ИНН внутри длинного числа не засчитывается', async () => {
    const page = `<html><body>Телефон 8${INN_A}1, счёт ${INN_A}00</body></html>`;
    const f = fetcher({ 'https://a.ru/': ok(page, 'https://a.ru/') });
    expect((await verifyCandidate('https://a.ru/', 'a.ru', COMPANY, f.fetch, 0)).innOnPage).toBe(false);
  });

  it('запрет, недоступность, перенаправление на другой сайт и не HTML — разные исходы', async () => {
    const cases: Array<[SiteFetchResult, string]> = [
      [{ kind: 'http', status: 403, retryAfterAt: null, message: 'HTTP 403' }, 'blocked'],
      [{ kind: 'http', status: 500, retryAfterAt: null, message: 'HTTP 500' }, 'unreachable'],
      [{ kind: 'policy', status: null, message: 'host_not_allowed: хост other.ru не разрешён' }, 'redirect_other_host'],
      [{ kind: 'dns', status: null, message: 'dns: не найден' }, 'unreachable'],
      [ok('%PDF-1.7 ...', 'https://a.ru/'), 'not_html'],
    ];
    for (const [result, status] of cases) {
      const check = await verifyCandidate('https://a.ru/', 'a.ru', COMPANY, async () => result, 0);
      expect(check.status, status).toBe(status);
      expect(check.innOnPage).toBeNull();
    }
  });

  it('главная без текста при скриптах — сайт рисуется в браузере', async () => {
    const spa = '<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>';
    const f = fetcher({ 'https://spa.ru/': ok(spa, 'https://spa.ru/') });
    expect((await verifyCandidate('https://spa.ru/', 'spa.ru', COMPANY, f.fetch, 0)).status).toBe('js_only');
  });

  it('разбор страницы: «ИНН» не склеивается с числом, скрипты не попадают в текст', () => {
    const { text, scripts } = pageText(`<p>ИНН</p><p>${INN_A}</p><script>var x = "${INN_B}"</script>`);
    expect(text).toBe(`ИНН ${INN_A}`);
    expect(scripts).toBe(1);
    expect(otherInnsIn(`ИНН № ${INN_B}, ИНН 1234567890, инн:${INN_A}`, INN_A)).toEqual([INN_B]);
    expect(infoLinks(HOME, 'https://donstroy.moscow/', candidatePolicy('donstroy.moscow'))).toHaveLength(2);
  });
});
