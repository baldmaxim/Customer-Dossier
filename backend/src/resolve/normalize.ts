// Нормализация названий компаний и объектов — единственный источник правды.
// Вызывается и при записи сущности, и при поиске кандидатов: если нормализация
// на записи и на поиске разойдётся, резолвер перестанет находить существующие
// компании и начнёт плодить дубли.
//
// Цель: свести «ТОО "BI Group"», «БИ Групп» и «BI Group» к одному ключу ДО
// нечёткого сравнения. Тогда pg_trgm остаётся только для настоящих опечаток,
// а не для разной графики одного и того же бренда.

/**
 * Организационно-правовые формы. Срезаются в начале и в конце названия.
 *
 * Основной набор — российский. Казахстанские формы оставлены: пересланный пост
 * про компанию из РК не должен ломать разбор, а лишние строки в списке ничего
 * не стоят.
 */
const LEGAL_FORMS = [
  // Россия
  'ооо', 'ао', 'пао', 'зао', 'оао', 'нао', 'ип', 'гк', 'фгуп', 'гуп', 'муп',
  'фгбу', 'гбу', 'мбу', 'ано', 'нко', 'пк', 'кфх', 'общество с ограниченной ответственностью',
  'акционерное общество', 'публичное акционерное общество',
  // Казахстан
  'тоо', 'тдо', 'кх', 'жшс', 'ақ', 'жақ', 'аақ',
  'кгп', 'гкп', 'ргп', 'кгу', 'гу', 'ку', 'гккп', 'рггп',
  // Иностранные
  'llp', 'llc', 'jsc', 'ltd', 'inc', 'gmbh', 'co',
] as const;

/** Типовые префиксы объектов. НЕ путать с ОПФ: «ЖК» у компании — ошибка разметки. */
const PROJECT_PREFIXES = [
  'жк', 'мфк', 'бц', 'трц', 'тц', 'жм', 'мкр', 'микрорайон', 'жилой комплекс',
  'бизнес центр', 'бизнес-центр', 'мжк', 'апарт-комплекс', 'апартаменты',
  'клубный дом', 'квартал',
] as const;

/**
 * Слова, которые сами по себе именем не являются — это роль или тип организации.
 * Сущность с таким name_norm создавать нельзя: она склеит десятки разных компаний.
 */
const JUNK_NAMES = new Set([
  'компания', 'застройщик', 'подрядчик', 'заказчик', 'генподрядчик', 'генеральный подрядчик',
  'проектировщик', 'инвестор', 'управление', 'отдел', 'товарищество', 'общество',
  'фирма', 'организация', 'предприятие', 'группа компаний', 'холдинг', 'девелопер',
  // Органы власти: в новостях упоминаются постоянно, компанией не являются
  'мэрия', 'префектура', 'управа', 'администрация', 'акимат', 'минстрой', 'правительство',
]);

/** Казахские буквы → русские аналоги: склеивает kk/ru написания одного бренда. */
const KZ_TO_RU: Record<string, string> = {
  'ә': 'а', 'ғ': 'г', 'қ': 'к', 'ң': 'н', 'ө': 'о',
  'ұ': 'у', 'ү': 'у', 'һ': 'х', 'і': 'и',
};

/**
 * Транслитерация под реальные бренды, а не ГОСТ: цель — чтобы «Базис» и «Bazis»
 * дали одну строку, а не чтобы результат читался по правилам транслитерации.
 */
const RU_TO_LAT: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z',
  'и': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p',
  'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch',
  'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

/**
 * Хвосты, которые в латинице пишут как попало. Применяется пословно, поэтому
 * «grupp» → «group», но «gruppa-invest» не пострадает (это один токен).
 */
const LATIN_SYNONYMS: Record<string, string> = {
  grupp: 'group', gruppa: 'group', grup: 'group', groop: 'group',
  stroi: 'stroy', stroj: 'stroy',
  kompani: 'company', kompaniya: 'company', comp: 'company',
  korporatsiya: 'corp', korporatsia: 'corp', corporation: 'corp',
  devlopment: 'development', developement: 'development',
  konstrakshn: 'construction', kompleks: 'complex',
  // Бренды, где кириллица и латиница расходятся не только графикой:
  // «Азия» транслитерируется в aziya, но пишется как Asia.
  aziya: 'asia', aziy: 'asia',
  kazakhstan: 'kz', kazakstan: 'kz', kz: 'kz',
};

const QUOTES = /[«»""„‟''‛`´"']/g;
const COLLAPSE = /\s+/g;

const collapse = (s: string): string => s.replace(COLLAPSE, ' ').trim();

/**
 * Срезает ОПФ в начале или в конце. Форма возвращается отдельно: это слабый
 * сигнал при сравнении (конфликт ТОО/АО снижает score), но частью имени она
 * быть не должна.
 */
const stripAffix = (
  input: string,
  affixes: readonly string[],
): { rest: string; affix: string | null } => {
  let rest = input;
  let affix: string | null = null;

  // Длинные формы вперёд, иначе «ао» съест начало «акционерное общество».
  const sorted = [...affixes].sort((a, b) => b.length - a.length);

  for (const form of sorted) {
    // Разделитель обязателен: без него «ипотека» превратится в «отека».
    const asPrefix = new RegExp(`^${form}[\\s.,"'«»-]+`, 'i');
    const asSuffix = new RegExp(`[\\s.,"'«»-]+${form}$`, 'i');
    if (asPrefix.test(rest)) {
      rest = rest.replace(asPrefix, '');
      affix = form;
      break;
    }
    if (asSuffix.test(rest)) {
      rest = rest.replace(asSuffix, '');
      affix = form;
      break;
    }
  }

  const cleaned = collapse(rest);
  // Если после среза не осталось ничего — значит вся строка была формой.
  // Возвращаем как было: пусть лучше сущность назовётся «ТОО», чем станет пустой.
  return cleaned.length === 0 ? { rest: input, affix: null } : { rest: cleaned, affix };
};

const toLatin = (ruNorm: string): string =>
  ruNorm
    .split('')
    .map(ch => RU_TO_LAT[ch] ?? ch)
    .join('');

const applySynonyms = (latin: string): string =>
  latin
    .split(' ')
    .map(token => LATIN_SYNONYMS[token] ?? token)
    .filter(t => t.length > 0)
    .join(' ');

export interface INormalizedName {
  /** Исходная строка после снятия кавычек и ОПФ — годится для показа. */
  display: string;
  /** Без ОПФ/кавычек, lower, казахские буквы сведены к русским. */
  norm: string;
  /** Транслит norm в латиницу + словарь синонимов. */
  latin: string;
  /** latin без пробелов. Основной ключ точного совпадения. */
  key: string;
  /** Срезанная ОПФ (ТОО/АО/...) либо null. */
  legalForm: string | null;
}

export type EntityKindForNormalize = 'company' | 'project';

/**
 * Полная нормализация. Порядок шагов важен: ОПФ срезается ДО схлопывания
 * пунктуации, иначе «ТОО.BI» и «ТОО BI» разойдутся.
 */
export const normalizeName = (
  raw: string,
  kind: EntityKindForNormalize = 'company',
): INormalizedName => {
  // 1. Unicode-нормализация: убирает разные варианты одной и той же буквы.
  let s = collapse(raw.normalize('NFKC'));

  // 2. Кавычки всех видов.
  s = collapse(s.replace(QUOTES, ' '));

  // 3. ОПФ (для компаний) или типовой префикс (для объектов).
  const affixes = kind === 'company' ? LEGAL_FORMS : PROJECT_PREFIXES;
  const { rest, affix } = stripAffix(s, affixes);
  const display = rest;

  // 4-5. lower, ё→е, казахские буквы → русские.
  let norm = display.toLowerCase().replace(/ё/g, 'е');
  norm = norm
    .split('')
    .map(ch => KZ_TO_RU[ch] ?? ch)
    .join('');

  // 6. Только буквы/цифры/пробел. Прочее — В ПРОБЕЛ, не в пустоту:
  //    «Базис-А» должен стать «базис а», а не «базиса».
  norm = collapse(norm.replace(/[^a-zа-я0-9 ]/g, ' '));

  // 7-8. Латиница + словарь хвостов.
  const latin = collapse(applySynonyms(toLatin(norm)));

  return {
    display,
    norm,
    latin,
    key: latin.replace(/ /g, ''),
    legalForm: affix ? affix.toUpperCase() : null,
  };
};

/**
 * Отсев мусора перед созданием сущности (шаг 0 резолвера).
 * Слишком короткое имя или голая роль вместо названия — не создаём.
 */
export const isJunkName = (normalized: INormalizedName): boolean => {
  if (normalized.norm.length < 3) return true;
  if (JUNK_NAMES.has(normalized.norm)) return true;
  // «ао», «тоо» и подобное, оставшееся после неудачного среза.
  if (normalized.key.length < 3) return true;
  if (GENERIC_AUTHORITY.test(normalized.norm)) return true;
  return false;
};

/**
 * Органы власти верхнего уровня с географическим уточнением: «правительство РФ»,
 * «минстрой России», «госдума».
 *
 * Точное совпадение со стоп-списком их не ловит: «правительство рф» — уже не
 * «правительство». На живых данных «правительство РФ» получало роль заказчика.
 *
 * Список намеренно узкий и не включает департаменты, управления, мэрии и
 * администрации: конкретный департамент — нередко настоящий заказчик по
 * госконтракту, и отсечь его значило бы потерять важный факт. Отсекаем только
 * тех, кто на уровне политики и объявлений, а не контрактов на объект.
 */
const GENERIC_AUTHORITY =
  /^(правительство|минстрой|минфин|минэкономразвития|госдума|президент|кремль)( (рф|россии|российской федерации|москвы))?$/;

/**
 * Признак «короткое односложное имя»: для таких автослияние запрещено —
 * «Аском» и «Асем» дают ложных срабатываний больше, чем истинных.
 */
export const isShortAmbiguousName = (normalized: INormalizedName): boolean => {
  const tokens = normalized.norm.split(' ').filter(t => t.length > 1);
  return tokens.length <= 1 && normalized.key.length < 6;
};

/**
 * Идентификаторы юрлиц РФ: ИНН, ОГРН, ОГРНИП.
 *
 * Проверяем контрольную сумму, а не только длину. Модель охотно принимает за
 * ИНН любое длинное число из текста — номер лицензии, кадастровый номер, сумму
 * без пробелов. Контрольная сумма отсекает такое почти полностью, и это дешевле
 * любых обращений к внешним реестрам.
 */

const digitsOf = (value: string): number[] => [...value].map(Number);

const weightedMod11 = (digits: readonly number[], weights: readonly number[]): number => {
  const sum = weights.reduce((acc, weight, i) => acc + weight * (digits[i] ?? 0), 0);
  return (sum % 11) % 10;
};

const INN10_WEIGHTS = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12_WEIGHTS_11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12_WEIGHTS_12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

/** ИНН юрлица — 10 цифр, ИНН физлица и ИП — 12. */
export const isValidInn = (value: string): boolean => {
  if (!/^[0-9]{10}$|^[0-9]{12}$/.test(value)) return false;
  const d = digitsOf(value);

  if (d.length === 10) return weightedMod11(d, INN10_WEIGHTS) === d[9];

  return (
    weightedMod11(d, INN12_WEIGHTS_11) === d[10] && weightedMod11(d, INN12_WEIGHTS_12) === d[11]
  );
};

/**
 * ОГРН (13 цифр) и ОГРНИП (15).
 *
 * Контроль: число из всех цифр, кроме последней, делится по модулю 11 (для
 * ОГРНИП — 13), и последняя цифра остатка совпадает с контрольной. Считаем
 * через BigInt: 14 цифр не помещаются в double без потери точности.
 */
export const isValidOgrn = (value: string): boolean => {
  if (!/^[0-9]{13}$|^[0-9]{15}$/.test(value)) return false;

  const divisor = value.length === 13 ? 11n : 13n;
  const body = BigInt(value.slice(0, -1));
  const control = Number(value.slice(-1));

  return Number((body % divisor) % 10n) === control;
};

/**
 * Любой принимаемый идентификатор компании. Казахстанский БИН (12 цифр)
 * проходит как ИНН физлица — пересланный пост про РК не сломает запись,
 * а разделять их в схеме ради этого не стоит.
 */
export const isValidTaxId = (value: string): boolean =>
  isValidInn(value) || isValidOgrn(value);
