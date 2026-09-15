// Словесные признаки смысла внутри цитаты: отрицание, план, слух, договор, участие, корпоративная связь.
//
// Проверка независима от модели: она не доказывает смысл, а ловит противоречие между
// тем, что вернула модель, и тем, что написано. Противоречие не превращается в
// «исправленный» ответ — утверждение уходит на проверку и не публикуется.

const test = (re: RegExp, text: string): boolean => re.test(text.normalize('NFC').replace(/ё/gi, m => (m === 'ё' ? 'е' : 'Е')));

const NEGATION =
  /(^|[^\p{L}])не\s+(является|являлся|являлась|являются|был[аио]?(?![\p{L}])|участв|заключ|подписан|подписал|привлека|привлеч|выполня|строит|ведет|возвод|поставля|входит|владеет|контролир|подтверд)|(^|[^\p{L}])нет\s+(договор|контракт|задерж|отношени)|опроверг|отрица|(^|[^\p{L}])ни\s+при\s+чем/iu;

const PLAN =
  /планиру|намерен|собира(ется|ются|лась|лся)|предполага|рассматрива(ет|ют)\s+(возможность|вариант)|ожида(ется|ют)\s+(заключ|подписан|привлеч)|будет\s+(заключ|привлеч|выбран|назнач|подписан)|в\s+планах|пока\s+не\s+подписан|готов(ит|ятся)\s+к\s+подписани/iu;

const RUMOR =
  /по\s+неподтвержденн|по\s+слухам|по\s+неофициальн|якобы|возможно|может\s+(покинуть|стать|быть|лишиться|сменить|уйти|выйти)|не\s+исключ|вероятно|предположительно|по\s+данным\s+(источник|канал|инсайдер)/iu;

const CONTRACT =
  /договор|контракт|соглашени|генподряд|субподряд|подряд|поставк|поставля|заключ|привлек|привлеч|нанял|наняла|выбра[лн].{0,40}(подрядчик|исполнител|поставщик)|заказ(ал|ала)/iu;

const PARTICIPATION =
  /заказчик|застройщик|девелопер|генподряд|подрядчик|субподряд|поставщик|поставля|поставк|проектировщик|проектир|инвестор|инвест|эксплуатир|управляющ|строит|возвод|выполня|монтаж|работ[аыу]|вед[её]т|реализу|привлеч|привлек|построил|построит|сдал|сдаст|приступил/iu;

/** Признак корпоративной связи — по её виду: слово «бренд» не доказывает владение, «владеет» — не бренд. */
const CORPORATE: Record<string, RegExp> = {
  owns_share: /владе|дол[яиюей](?![\p{L}])|доли(?![\p{L}])|акционер|учредител|бенефициар|пакет\s+акций/iu,
  controls: /контролир|под\s+контролем|дочерн|бенефициар|материнск/iu,
  member_of_group: /входит\s+в\s+(группу|холдинг|состав)|групп[аеыу]\s+компаний|холдинг|дочерн/iu,
  brand_of: /бренд|под\s+маркой|торгов\p{L}*\s+марк/iu,
};

const OUTCOME = /удовлетвор|отказал|отказано|отклон|оставил\s+без|отменил|отменен|мирово|частично|взыскал|взыскано|присудил|признал/iu;
const AWARD = /взыскал|взыскано|присудил|присуждено|удовлетворил|удовлетворен|обязал\s+выплатить/iu;
const CASE_STAGE_APPEAL = /апелляц|обжал|кассац/iu;

const BANKRUPTCY: Record<string, RegExp> = {
  bankruptcy_intent: /намерен|намерени|уведомлени|сообщени[ея]\s+о\s+намерении|собира(ется|ются)\s+обратиться/iu,
  bankruptcy_filing: /заявлени|подал|подала|подано|обратил|иск\s+о\s+банкрот|требовани[ея]\s+о\s+признании/iu,
  bankruptcy_procedure: /наблюдени|конкурсн|внешнее\s+управлени|финансовое\s+оздоровлени|признан[аоы]?\s+банкрот|реализаци[яи]\s+имущества|введен/iu,
};

export const hasNegation = (text: string): boolean => test(NEGATION, text);
export const hasPlan = (text: string): boolean => test(PLAN, text);
export const hasRumor = (text: string): boolean => test(RUMOR, text);
export const hasContractCue = (text: string): boolean => test(CONTRACT, text);
export const hasParticipationCue = (text: string): boolean => test(PARTICIPATION, text);
export const hasCorporateCue = (kind: string, text: string): boolean => {
  const re = CORPORATE[kind];
  return re ? test(re, text) : false;
};
export const hasOutcomeCue = (text: string): boolean => test(OUTCOME, text);
export const hasAwardCue = (text: string): boolean => test(AWARD, text);
export const hasAppealCue = (text: string): boolean => test(CASE_STAGE_APPEAL, text);
export const hasBankruptcyCue = (type: string, text: string): boolean => {
  const re = BANKRUPTCY[type];
  return re ? test(re, text) : true;
};

/**
 * Противоречие модальности и полярности цитате. Более осторожная модальность
 * (planned/possible/claim) всегда допустима; утверждение «так и есть» при
 * отрицании, плане или слухе в цитате — нет.
 */
export const modalityConflict = (polarity: 'positive' | 'negative', modality: string, quote: string): string | null => {
  if (polarity === 'negative') {
    return hasNegation(quote) ? null : 'отрицание не найдено в цитате';
  }
  if (modality !== 'reported_fact') return null;
  if (hasNegation(quote)) return 'в цитате отрицание, а утверждение положительное';
  if (hasPlan(quote)) return 'в цитате план или намерение, а утверждение — состоявшийся факт';
  if (hasRumor(quote)) return 'в цитате слух или неподтверждённое сообщение, а утверждение — состоявшийся факт';
  return null;
};
