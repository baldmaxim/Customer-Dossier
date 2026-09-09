// Гейт против галлюцинаций — самая ценная часть пайплайна.
//
// Локальная модель на 8B регулярно «вспоминает» компании, которых в тексте нет,
// и приписывает им роли. Единственная защита, которая реально работает, —
// требовать доказательство: дословную цитату из исходного текста, внутри которой
// стоит имя сущности. Всё, что не доказано, до канонического слоя не доходит.
//
// Пороги здесь сознательно консервативные. Ложный факт в карточке Заказчика
// стоит доверия к порталу целиком; пропущенный факт стоит одного упоминания.

import { normalizeName } from '../resolve/normalize.js';
import type {
  ICompanyExtract,
  IEventExtract,
  IExtraction,
  ILinkExtract,
  IProjectExtract,
} from '../llm/schema.js';

/** Множитель, если цитата не найдена в тексте дословно. */
const UNVERIFIED_QUOTE_FACTOR = 0.5;

/** Порог схожести имени с фрагментом цитаты (имя может стоять в другом падеже). */
const NAME_IN_QUOTE_THRESHOLD = 0.6;

export const CONFIDENCE_THRESHOLDS = {
  mention: 0.7,
  event: 0.8,
  participant: 0.85,
} as const;

/** Раньше независимости РК события в этой предметной области быть не может. */
const MIN_EVENT_DATE = new Date('1991-01-01T00:00:00Z');

/** Приведение к форме, в которой сравниваются цитата и текст. */
const flatten = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(/[«»""„‟''`´"']/g, '"')
    .replace(/[ \s]+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * Цитата обязана дословно находиться в тексте. Сравниваем по схлопнутым
 * пробелам и нижнему регистру: модель нормализует пробелы, и требовать
 * побайтового совпадения бессмысленно.
 */
export const isQuoteVerbatim = (quote: string, body: string): boolean => {
  const q = flatten(quote);
  if (q.length < 10) return false;
  return flatten(body).includes(q);
};

/** Триграммная схожесть — тот же принцип, что у pg_trgm, но без обращения к БД. */
const trigrams = (s: string): Set<string> => {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) out.add(padded.slice(i, i + 3));
  return out;
};

export const trigramSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = trigrams(a);
  const setB = trigrams(b);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
};

/**
 * Имя сущности должно встречаться внутри своей цитаты. Проверка нечёткая:
 * в тексте имя стоит в падеже («компании BI Group»), а модель отдаёт
 * именительный. Но выдуманное название не наберёт схожести ни с одним окном.
 */
export const isNameInQuote = (name: string, quote: string): boolean => {
  const normalizedName = normalizeName(name).norm;
  if (normalizedName.length === 0) return false;

  const normalizedQuote = flatten(quote).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ');
  if (normalizedQuote.includes(normalizedName)) return true;

  // Скользящее окно длиной с имя: ищем достаточно похожий фрагмент.
  const words = normalizedQuote.split(' ');
  const nameWordCount = normalizedName.split(' ').length;
  for (let i = 0; i <= words.length - nameWordCount; i += 1) {
    const window = words.slice(i, i + nameWordCount).join(' ');
    if (trigramSimilarity(normalizedName, window) >= NAME_IN_QUOTE_THRESHOLD) return true;
  }
  return false;
};

/** БИН принимаем, только если эти 12 цифр физически есть в тексте. */
export const isBinPresentInBody = (bin: string, body: string): boolean => {
  if (!/^[0-9]{12}$/.test(bin)) return false;
  return body.replace(/[\s-]/g, '').includes(bin);
};

/**
 * Дата события: не раньше 1991 и не позже публикации + 5 лет. Верхняя граница
 * нужна, потому что модель охотно превращает «сдача в 2030 году» в дату события,
 * хотя это план, а не факт.
 */
export const isPlausibleEventDate = (raw: string, publishedAt: Date | null): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date < MIN_EVENT_DATE) return null;

  const base = publishedAt ?? new Date();
  const upperBound = new Date(base);
  upperBound.setUTCFullYear(upperBound.getUTCFullYear() + 5);
  if (date > upperBound) return null;

  return date;
};

/** Сумма принимается, только если такое число встречается в тексте. */
export const isAmountInBody = (amount: number, body: string): boolean => {
  const digits = String(Math.round(amount));
  const bodyDigits = body.replace(/[\s .,]/g, '');
  if (bodyDigits.includes(digits)) return true;
  // «12,5 млрд» в тексте против 12500000000 в ответе: сверяем значащие цифры.
  const significant = digits.replace(/0+$/, '');
  return significant.length >= 2 && bodyDigits.includes(significant);
};

export interface IVerifiedCompany extends ICompanyExtract {
  quoteVerified: boolean;
  confidenceFinal: number;
  binAccepted: string | null;
}

export interface IVerifiedProject extends IProjectExtract {
  quoteVerified: boolean;
  confidenceFinal: number;
}

export interface IVerifiedEvent extends Omit<IEventExtract, 'occurred_on' | 'amount_kzt'> {
  occurredOn: Date | null;
  amountKzt: number | null;
  quoteVerified: boolean;
  confidenceFinal: number;
}

export interface IVerifiedLink extends ILinkExtract {
  confidenceFinal: number;
}

export interface IVerificationResult {
  relevant: boolean;
  companies: IVerifiedCompany[];
  projects: IVerifiedProject[];
  links: IVerifiedLink[];
  events: IVerifiedEvent[];
  /** Что и почему отброшено — для отладки промпта и для админки. */
  rejected: Array<{ kind: string; name: string; reason: string }>;
}

/**
 * Полная проверка результата извлечения против исходного текста.
 * Ничего не пишет в БД — чистая функция, чтобы её можно было прогнать
 * на выборке документов и сравнить версии промпта.
 */
export const verifyExtraction = (
  extraction: IExtraction,
  body: string,
  publishedAt: Date | null,
): IVerificationResult => {
  const rejected: IVerificationResult['rejected'] = [];

  if (!extraction.doc_relevant) {
    return { relevant: false, companies: [], projects: [], links: [], events: [], rejected };
  }

  const companies: IVerifiedCompany[] = [];
  for (const company of extraction.companies) {
    const quoteVerified = isQuoteVerbatim(company.quote, body);

    // Имя обязано быть в цитате. Это отсекает выдуманные названия: модель может
    // сочинить компанию, но не может подставить её в реальный фрагмент текста.
    if (!isNameInQuote(company.name, company.quote)) {
      rejected.push({ kind: 'company', name: company.name, reason: 'имя отсутствует в цитате' });
      continue;
    }

    const binAccepted =
      company.bin && isBinPresentInBody(company.bin, body) ? company.bin : null;
    if (company.bin && !binAccepted) {
      rejected.push({ kind: 'bin', name: company.name, reason: 'БИН отсутствует в тексте' });
    }

    companies.push({
      ...company,
      quoteVerified,
      binAccepted,
      confidenceFinal: company.confidence * (quoteVerified ? 1 : UNVERIFIED_QUOTE_FACTOR),
    });
  }

  const projects: IVerifiedProject[] = [];
  for (const project of extraction.projects) {
    const quoteVerified = isQuoteVerbatim(project.quote, body);
    if (!isNameInQuote(project.name, project.quote)) {
      rejected.push({ kind: 'project', name: project.name, reason: 'имя отсутствует в цитате' });
      continue;
    }
    projects.push({
      ...project,
      quoteVerified,
      confidenceFinal: project.confidence * (quoteVerified ? 1 : UNVERIFIED_QUOTE_FACTOR),
    });
  }

  // Ссылочная целостность: links и events указывают на сущности по именам из
  // этого же ответа. После отбраковки часть имён исчезла — висячие ссылки
  // отбрасываем, но документ не роняем.
  const companyNames = new Set(companies.map(c => c.name));
  const projectNames = new Set(projects.map(p => p.name));

  const links: IVerifiedLink[] = [];
  for (const link of extraction.links) {
    if (!companyNames.has(link.company)) {
      rejected.push({ kind: 'link', name: link.company, reason: 'ссылка на отброшенную компанию' });
      continue;
    }
    if (!projectNames.has(link.project)) {
      rejected.push({ kind: 'link', name: link.project, reason: 'ссылка на отброшенный объект' });
      continue;
    }
    // Роль unknown в participants не пишется — связь без роли бессмысленна.
    if (link.role === 'unknown') {
      rejected.push({ kind: 'link', name: link.company, reason: 'роль unknown' });
      continue;
    }
    const company = companies.find(c => c.name === link.company);
    const project = projects.find(p => p.name === link.project);
    // Уверенность связи не может превышать уверенность в её концах.
    const cap = Math.min(company?.confidenceFinal ?? 0, project?.confidenceFinal ?? 0);
    links.push({ ...link, confidenceFinal: Math.min(link.confidence, cap) });
  }

  const events: IVerifiedEvent[] = [];
  for (const event of extraction.events) {
    const quoteVerified = isQuoteVerbatim(event.quote, body);

    // У события должен быть хотя бы один известный участник, иначе его некуда
    // привязать и в метрики оно не попадёт.
    const hasAnchor =
      (event.company && companyNames.has(event.company)) ||
      (event.project && projectNames.has(event.project));
    if (!hasAnchor) {
      rejected.push({ kind: 'event', name: event.type, reason: 'нет подтверждённого участника' });
      continue;
    }

    const occurredOn = event.occurred_on
      ? isPlausibleEventDate(event.occurred_on, publishedAt)
      : null;
    if (event.occurred_on && !occurredOn) {
      rejected.push({ kind: 'event_date', name: event.type, reason: `неправдоподобная дата ${event.occurred_on}` });
    }

    const amountKzt =
      event.amount_kzt != null && isAmountInBody(event.amount_kzt, body) ? event.amount_kzt : null;
    if (event.amount_kzt != null && amountKzt === null) {
      rejected.push({ kind: 'event_amount', name: event.type, reason: 'сумма отсутствует в тексте' });
    }

    const { occurred_on: _o, amount_kzt: _a, ...rest } = event;
    events.push({
      ...rest,
      occurredOn,
      amountKzt,
      quoteVerified,
      confidenceFinal: event.confidence * (quoteVerified ? 1 : UNVERIFIED_QUOTE_FACTOR),
    });
  }

  return { relevant: true, companies, projects, links, events, rejected };
};
