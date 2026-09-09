// Нормализация названий компаний и объектов — единственный источник правды.
// Вызывается и при записи сущности, и при поиске кандидатов: если нормализация
// на записи и на поиске разойдётся, резолвер перестанет находить существующие
// компании и начнёт плодить дубли.
//
// Цель: свести «ТОО "BI Group"», «БИ Групп» и «BI Group» к одному ключу ДО
// нечёткого сравнения. Тогда pg_trgm остаётся только для настоящих опечаток,
// а не для разной графики одного и того же бренда.

/** Организационно-правовые формы РК и соседей. Срезаются в начале и в конце. */
const LEGAL_FORMS = [
  'тоо', 'ао', 'зао', 'оао', 'ооо', 'ип', 'тдо', 'пк', 'кх',
  'жшс', 'ақ', 'жақ', 'аақ', 'акционерное общество', 'товарищество с ограниченной ответственностью',
  'кгп', 'гкп', 'ргп', 'кгу', 'гу', 'ку', 'гккп', 'рггп',
  'llp', 'llc', 'jsc', 'ltd', 'inc', 'gmbh', 'co',
] as const;

/** Типовые префиксы объектов. НЕ путать с ОПФ: «ЖК» у компании — ошибка разметки. */
const PROJECT_PREFIXES = [
  'жк', 'мфк', 'бц', 'трц', 'тц', 'жм', 'мкр', 'микрорайон', 'жилой комплекс',
  'бизнес центр', 'бизнес-центр', 'мжк',
] as const;

/**
 * Слова, которые сами по себе именем не являются — это роль или тип организации.
 * Сущность с таким name_norm создавать нельзя: она склеит десятки разных компаний.
 */
const JUNK_NAMES = new Set([
  'компания', 'застройщик', 'подрядчик', 'заказчик', 'генподрядчик', 'генеральный подрядчик',
  'проектировщик', 'инвестор', 'акимат', 'управление', 'отдел', 'товарищество', 'общество',
  'фирма', 'организация', 'предприятие', 'группа компаний', 'холдинг',
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
  return false;
};

/**
 * Признак «короткое односложное имя»: для таких автослияние запрещено —
 * «Аском» и «Асем» дают ложных срабатываний больше, чем истинных.
 */
export const isShortAmbiguousName = (normalized: INormalizedName): boolean => {
  const tokens = normalized.norm.split(' ').filter(t => t.length > 1);
  return tokens.length <= 1 && normalized.key.length < 6;
};

/** БИН РК: 12 цифр, 5-я цифра — признак юрлица (4/5/6). */
export const isValidBin = (bin: string): boolean => {
  if (!/^[0-9]{12}$/.test(bin)) return false;
  const fifth = bin[4];
  return fifth === '4' || fifth === '5' || fifth === '6';
};
