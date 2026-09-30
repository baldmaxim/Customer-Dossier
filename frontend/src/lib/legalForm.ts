// Организационно-правовая форма в названии: реестр и источники пишут её то полностью
// («Общество с ограниченной ответственностью …»), то сокращённо («ООО …»).
//
// Граница слова — просмотром вперёд, не \b: в JS \b знает только латиницу, и после кириллицы
// не срабатывает.

const END = String.raw`(?=[\s«"„]|$)`;

const FORMS: ReadonlyArray<readonly [short: string, full: RegExp]> = [
  ['ПАО', new RegExp(`^публичное акционерное общество${END}`, 'i')],
  ['НАО', new RegExp(`^непубличное акционерное общество${END}`, 'i')],
  ['ЗАО', new RegExp(`^закрытое акционерное общество${END}`, 'i')],
  ['ОАО', new RegExp(`^открытое акционерное общество${END}`, 'i')],
  ['АО', new RegExp(`^акционерное общество${END}`, 'i')],
  ['ООО', new RegExp(`^общество с ограниченной ответственностью${END}`, 'i')],
  ['ТОО', new RegExp(`^товарищество с ограниченной ответственностью${END}`, 'i')],
  ['ИП', new RegExp(`^индивидуальный предприниматель${END}`, 'i')],
];

/** Название уже начинается с какой-то сокращённой формы — другую перед ним не ставим. */
const SHORT_FORM = new RegExp(`^(ООО|ПАО|НАО|ЗАО|ОАО|АО|ТОО|ИП|ГУП|МУП|ФГУП)${END}`, 'i');

const SPECIAL_DEVELOPER = new RegExp(`(^|\\s)специализированный застройщик${END}`, 'i');

/**
 * Название с формой впереди — без повтора: «ООО» перед «Общество с ограниченной ответственностью …»
 * давало «ООО Общество с …» (так было в панели реестра).
 */
export const withLegalForm = (name: string, form: string | null | undefined): string => {
  const shortForm = form?.trim();
  const trimmed = name.trim();
  if (!shortForm) return trimmed;
  if (trimmed.toLowerCase().startsWith(shortForm.toLowerCase())) return trimmed;
  if (SHORT_FORM.test(trimmed) || FORMS.some(([, full]) => full.test(trimmed))) return trimmed;
  return `${shortForm} ${trimmed}`;
};

/** Короткая запись для тесных мест (узел схемы): «ООО СЗ „…“». Полное название — в подсказке. */
export const shortenLegalForm = (name: string): string => {
  let out = name.trim();
  const form = FORMS.find(([, full]) => full.test(out));
  if (form) out = out.replace(form[1], form[0]);
  return out.replace(SPECIAL_DEVELOPER, '$1СЗ').replace(/\s{2,}/g, ' ');
};
