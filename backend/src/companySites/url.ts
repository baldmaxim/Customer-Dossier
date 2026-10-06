// Адрес сайта компании и приём предложений модели (этап 25A, ADR-018). Чистые функции, без сети.
//
// Главное правило — аналог «цитата есть в тексте» конвейера: адрес, который назвала модель, принимается,
// только если его хост был среди страниц, которые отдал поиск (или это корень такого хоста). Выдуманный
// адрес до оператора не дойдёт. Справочники, агрегаторы, соцсети и СМИ сайтом компании не считаются.

import net from 'node:net';
import { domainToASCII } from 'node:url';

import type { ILlmCitation } from '../llm/client.js';
import type { ISiteSearchSite } from '../llm/siteSearch/schema.js';

export interface ISiteAddress {
  /** Хост без «www.» в нижнем регистре (punycode): ключ кандидата. */
  host: string;
  /** Origin как назвали: протокол и хост с «www.», если он был, — с ним сайт и открывается. */
  url: string;
}

/**
 * Адрес сайта из строки модели, поиска или оператора: только http(s), без логина, порта и IP; путь
 * отбрасывается — кандидат это сайт целиком. Без схемы — https. Не адрес — null.
 */
export const normalizeSiteUrl = (raw: string): ISiteAddress | null => {
  const text = raw.trim();
  if (text === '' || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '' || url.port !== '') return null;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname.startsWith('[') || net.isIP(hostname) !== 0) return null;
  if (!/^[a-z0-9.-]+$/.test(hostname) || !hostname.includes('.')) return null;
  const labels = hostname.split('.');
  if (labels.some(label => label === '' || label.startsWith('-') || label.endsWith('-'))) return null;
  const tld = labels[labels.length - 1]!;
  if (tld.length < 2 || /^[0-9]+$/.test(tld)) return null;
  const host = hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  if (!host.includes('.')) return null;
  return { host, url: `${url.protocol}//${hostname}/` };
};

/** Хост входит в домен: совпадает или его поддомен. */
export const hostWithin = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/**
 * Не сайты компаний: справочники реквизитов, агрегаторы новостроек и вакансий, карты, соцсети, СМИ,
 * государственные сайты. Сравнение — с поддоменами (`companies.rbc.ru` — тоже РБК).
 */
const NOT_COMPANY_SITE_DOMAINS: readonly string[] = [
  // Реквизиты и проверка контрагентов.
  'rusprofile.ru', 'checko.ru', 'list-org.com', 'zachestnyibiznes.ru', 'sbis.ru', 'kontur.ru', 'spark-interfax.ru',
  'audit-it.ru', 'vbankcenter.ru', 'ogrn.online', 'egrul.org', 'saby.ru', 'rbc.ru', 'b2b-center.ru', 'synapsenet.ru',
  'datanewton.ru', 'innproverka.ru', 'companium.ru', 'licenzii.ru', 'tadviser.ru',
  // Государство.
  'nalog.ru', 'nalog.gov.ru', 'gov.ru', 'mos.ru', 'zakupki.gov.ru', 'fedresurs.ru', 'kad.arbitr.ru', 'arbitr.ru',
  'наш.дом.рф', 'дом.рф', 'ерз.рф', 'erzrf.ru',
  // Новостройки, недвижимость, вакансии, карты, поиск.
  'cian.ru', 'avito.ru', 'domclick.ru', 'novostroy.ru', 'novostroy-m.ru', 'novostroy-spb.ru', 'yandex.ru', 'ya.ru',
  'google.com', '2gis.ru', '2gis.com', 'hh.ru', 'superjob.ru', 'zarplata.ru', 'irr.ru', 'n1.ru', 'restate.ru', 'realty.ru',
  'move.ru', 'domofond.ru', 'gdeetotdom.ru', 'nmarket.pro', 'bn.ru', 'flatoutlet.ru',
  // Соцсети, мессенджеры, видео, справки.
  'vk.com', 'vk.ru', 'ok.ru', 't.me', 'telegram.me', 'telegram.org', 'facebook.com', 'instagram.com', 'youtube.com',
  'rutube.ru', 'dzen.ru', 'zen.yandex.ru', 'wikipedia.org', 'livejournal.com', 'pikabu.ru', 'otzovik.com', 'irecommend.ru',
  // СМИ.
  'kommersant.ru', 'vedomosti.ru', 'ria.ru', 'tass.ru', 'interfax.ru', 'irn.ru', 'lenta.ru', 'gazeta.ru', 'iz.ru',
  'forbes.ru', 'banki.ru', 'cre.ru', 'ancb.ru', 'stroygaz.ru', 'sravni.ru',
];

const DENY = NOT_COMPANY_SITE_DOMAINS.map(domain => domainToASCII(domain) || domain);

/** Хост справочника, агрегатора, соцсети, СМИ или госсайта: сайтом компании не считается. */
export const isNotCompanySite = (host: string): boolean => host.endsWith('.gov.ru') || DENY.some(domain => hostWithin(host, domain));

export interface IAcceptedSite extends ISiteAddress {
  reason: string;
  /** Заголовок и фрагмент найденной страницы этого хоста — оператору рядом с адресом. */
  title: string | null;
  snippet: string | null;
}

export type SiteRejection = 'bad_url' | 'not_company_site' | 'not_in_search_results' | 'duplicate';

export interface ISiteAcceptance {
  accepted: IAcceptedSite[];
  rejected: Array<{ url: string; why: SiteRejection }>;
  /** Хосты страниц, которые отдал поиск: для пробы и журнала. */
  citationHosts: string[];
}

/**
 * Приём предложений модели: адрес разобран, не справочник и найден поиском — хост совпал с хостом одной из
 * страниц выдачи или является его корнем (модель назвала `donstroy.moscow` по странице `msk.donstroy.moscow`).
 * Поддомен, которого поиск не показывал, не принимается: его модель могла придумать.
 */
export const acceptCandidates = (sites: readonly ISiteSearchSite[], citations: readonly ILlmCitation[]): ISiteAcceptance => {
  const cited = citations
    .map(c => ({ address: normalizeSiteUrl(c.url), citation: c }))
    .filter((c): c is { address: ISiteAddress; citation: ILlmCitation } => c.address !== null);
  const citationHosts = [...new Set(cited.map(c => c.address.host))];
  const accepted: IAcceptedSite[] = [];
  const rejected: ISiteAcceptance['rejected'] = [];
  for (const site of sites) {
    const address = normalizeSiteUrl(site.url);
    if (!address) {
      rejected.push({ url: site.url, why: 'bad_url' });
      continue;
    }
    if (isNotCompanySite(address.host)) {
      rejected.push({ url: site.url, why: 'not_company_site' });
      continue;
    }
    const match = cited.find(c => hostWithin(c.address.host, address.host));
    if (!match) {
      rejected.push({ url: site.url, why: 'not_in_search_results' });
      continue;
    }
    if (accepted.some(a => a.host === address.host)) {
      rejected.push({ url: site.url, why: 'duplicate' });
      continue;
    }
    accepted.push({ ...address, reason: site.reason, title: match.citation.title, snippet: match.citation.content?.slice(0, 500) ?? null });
  }
  return { accepted, rejected, citationHosts };
};
