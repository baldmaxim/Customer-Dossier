// Гейт против галлюцинаций — самая ценная часть пайплайна.
//
// Локальная модель на 8B регулярно «вспоминает» компании, которых в тексте нет,
// и приписывает им роли. Единственная защита, которая реально работает, —
// требовать доказательство: дословную цитату из исходного текста, внутри которой
// стоит имя сущности. Всё, что не доказано, до канонического слоя не доходит.
//
// Пороги здесь сознательно консервативные. Ложный факт в карточке Заказчика
// стоит доверия к порталу целиком; пропущенный факт стоит одного упоминания.

import { normalizeName, isValidTaxId } from '../resolve/normalize.js';
import { NON_PARTICIPANT_ROLES } from '../llm/schema.js';
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

/** Нижняя граница правдоподобия: до распада СССР рынка в нынешнем виде не было. */
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

/**
 * ИНН/ОГРН принимаем только при двух условиях сразу: контрольная сумма сходится
 * И эти цифры физически есть в тексте.
 *
 * Одной контрольной суммы мало: модель может подставить настоящий ИНН другой
 * компании, «вспомнив» его. Одного вхождения в текст тоже мало: длинных чисел
 * в новостях полно — кадастровые номера, суммы, номера лицензий.
 */
export const isTaxIdPresentInBody = (taxId: string, body: string): boolean => {
  if (!isValidTaxId(taxId)) return false;
  return body.replace(/[\s-]/g, '').includes(taxId);
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

/**
 * Значения-заглушки, которые модель ставит вместо null.
 *
 * Схема требует строку или null, но модель регулярно пишет «unknown» — и это
 * попадает в отбраковку как «города unknown нет в тексте», засоряя разбор
 * ложными срабатываниями. Приводим к null явно.
 */
const PLACEHOLDER_VALUES = new Set([
  'unknown', 'n/a', 'na', 'none', 'null', '-', '—',
  'неизвестно', 'не указан', 'не указано', 'нет данных', 'не определено',
]);

/** null, если значение отсутствует или является заглушкой. */
export const nullifyPlaceholder = (value: string | null | undefined): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return PLACEHOLDER_VALUES.has(trimmed.toLowerCase()) ? null : trimmed;
};

/**
 * Город принимается, только если он упомянут в тексте.
 *
 * Без этой проверки модель дописывает город «по смыслу»: пост про московский
 * ЗИЛ получал город Алматы просто потому, что портал тогда строился под РК. Цена
 * ошибки выше, чем кажется: город — сильный сигнал при сопоставлении объектов
 * (несовпадение запрещает автослияние, совпадение добавляет очки), поэтому
 * выдуманный город тихо разваливает резолвинг.
 *
 * Сравниваем по основе слова: в тексте город стоит в падеже («в Астане»),
 * а модель отдаёт именительный. Отбрасывание двух последних букв покрывает
 * русские склонения и не трогает несклоняемые названия.
 */
export const isCityMentionedInBody = (city: string, body: string): boolean => {
  const normalized = normalizeName(city).norm;
  if (normalized.length < 3) return false;

  const haystack = normalizeName(body).norm;

  return normalized
    .split(' ')
    .filter(token => token.length >= 4)
    .some(token => haystack.includes(stem(token)));
};

/**
 * Основа слова для поиска по тексту.
 *
 * В тексте слово стоит в падеже, а модель отдаёт начальную форму: «в Астане»
 * против «Астана», «на Автозаводской» против «Автозаводская». Точное вхождение
 * такие пары не находит.
 *
 * Отсекаем окончание по длине: у прилагательных оно длиннее (-ая, -ой, -ые),
 * у существительных короче. Полноценная лемматизация потребовала бы словаря
 * русской морфологии — для проверки «есть ли это слово в тексте вообще» это
 * несоразмерно, а ошибка в обе стороны здесь дёшева.
 */
const stem = (token: string): string => {
  if (token.length >= 9) return token.slice(0, -3);
  if (token.length >= 5) return token.slice(0, -2);
  return token;
};

/**
 * Адрес принимается, если большая часть его значимых слов есть в тексте.
 * Целиком совпадать он не обязан: модель нормализует «ул.» и порядок частей.
 */
export const isAddressGroundedInBody = (address: string, body: string): boolean => {
  const haystack = normalizeName(body).norm;
  const tokens = normalizeName(address)
    .norm.split(' ')
    .filter(token => token.length >= 3);

  if (tokens.length === 0) return false;
  const found = tokens.filter(token => haystack.includes(stem(token))).length;
  return found / tokens.length >= 0.6;
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
  taxIdAccepted: string | null;
}

export interface IVerifiedProject extends Omit<IProjectExtract, 'city' | 'address'> {
  /** null, если города нет в тексте: домысел модели в канон не пускаем. */
  city: string | null;
  address: string | null;
  quoteVerified: boolean;
  confidenceFinal: number;
}

export interface IVerifiedEvent extends Omit<IEventExtract, 'occurred_on' | 'amount_rub'> {
  occurredOn: Date | null;
  amountRub: number | null;
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

  // Ключи названий объектов этого же ответа. Если модель положила одно и то же
  // название и в компании, и в объекты, верим объекту: на живых данных
  // «СберСити» и «STONE Савеловская 2» получали роль генподрядчика и заказчика,
  // хотя это район и корпус. Обратная ошибка (компания, записанная объектом)
  // встречается реже и стоит дешевле — объект без роли не попадает в метрики.
  const projectKeys = new Set(
    extraction.projects.map(p => normalizeName(p.name, 'project').key).filter(k => k.length > 0),
  );

  const companies: IVerifiedCompany[] = [];
  for (const company of extraction.companies) {
    if (projectKeys.has(normalizeName(company.name, 'project').key)) {
      rejected.push({
        kind: 'company',
        name: company.name,
        reason: 'название совпадает с объектом из того же разбора — это объект, не компания',
      });
      continue;
    }

    const quoteVerified = isQuoteVerbatim(company.quote, body);

    // Имя обязано быть в цитате. Это отсекает выдуманные названия: модель может
    // сочинить компанию, но не может подставить её в реальный фрагмент текста.
    if (!isNameInQuote(company.name, company.quote)) {
      rejected.push({ kind: 'company', name: company.name, reason: 'имя отсутствует в цитате' });
      continue;
    }

    const taxIdAccepted =
      company.tax_id && isTaxIdPresentInBody(company.tax_id, body) ? company.tax_id : null;
    if (company.tax_id && !taxIdAccepted) {
      rejected.push({ kind: 'tax_id', name: company.name, reason: 'ИНН/ОГРН отсутствует в тексте' });
    }

    companies.push({
      ...company,
      quoteVerified,
      taxIdAccepted,
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
    const cityClaim = nullifyPlaceholder(project.city);
    const cityAccepted = cityClaim && isCityMentionedInBody(cityClaim, body) ? cityClaim : null;
    if (cityClaim && cityAccepted === null) {
      rejected.push({
        kind: 'city',
        name: project.name,
        reason: `город «${cityClaim}» отсутствует в тексте`,
      });
    }

    const addressClaim = nullifyPlaceholder(project.address);
    const addressAccepted =
      addressClaim && isAddressGroundedInBody(addressClaim, body) ? addressClaim : null;
    if (addressClaim && addressAccepted === null) {
      rejected.push({ kind: 'address', name: project.name, reason: 'адрес отсутствует в тексте' });
    }

    projects.push({
      ...project,
      city: cityAccepted,
      address: addressAccepted,
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
    if (NON_PARTICIPANT_ROLES.has(link.role)) {
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

    const amountRub =
      event.amount_rub != null && isAmountInBody(event.amount_rub, body) ? event.amount_rub : null;
    if (event.amount_rub != null && amountRub === null) {
      rejected.push({ kind: 'event_amount', name: event.type, reason: 'сумма отсутствует в тексте' });
    }

    const { occurred_on: _o, amount_rub: _a, ...rest } = event;
    events.push({
      ...rest,
      occurredOn,
      amountRub,
      quoteVerified,
      confidenceFinal: event.confidence * (quoteVerified ? 1 : UNVERIFIED_QUOTE_FACTOR),
    });
  }

  return { relevant: true, companies, projects, links, events, rejected };
};
