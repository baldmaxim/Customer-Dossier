// Иерархия объекта: комплекс → очередь → корпус (этап 04).
//
// «ЖК Берег, корпус 3» и «ЖК Берег, корпус 4» — один комплекс и два разных
// корпуса, а не два ЖК и не один объект. Разбор консервативный: распознаются
// только явные слова «очередь» и «корпус/строение/дом N»; всё остальное —
// название комплекса целиком.

export type ProjectLevel = 'complex' | 'phase' | 'building';

export interface IProjectPath {
  complex: string;
  phase: string | null;
  building: string | null;
}

// Граница слова для кириллицы: \b в JS считает только латиницу.
const START = '(?:^|[\\s,;(—–-])';
const END = '(?![0-9а-яёa-z])';
// Обозначение после слова: цифры с необязательной буквой (3, 2а, 12-Б) или римские цифры.
const LABEL = '([0-9]{1,4}(?:[-\\s]?[а-яa-z])?|[ivx]{1,5})';
// Порядковая форма перед словом требует окончания («2-я очередь», «3-й корпус»):
// «Квартал 5 корпус» без окончания — скорее название, чем номер.
const ORDINAL = '([0-9]{1,4})\\s*-?\\s*(?:я|й|ая|ый|ой)';

const PHASE_PATTERNS = [
  new RegExp(`${START}${ORDINAL}\\s+очеред(?:ь|и)${END}`, 'iu'),
  new RegExp(`${START}очеред(?:ь|и)\\s*№?\\s*${LABEL}${END}`, 'iu'),
];

const BUILDING_PATTERNS = [
  new RegExp(`${START}(?:корпус|корп\\.|строение|стр\\.|литер|дом)\\s*№?\\s*${LABEL}${END}`, 'iu'),
  new RegExp(`${START}${ORDINAL}\\s+корпус${END}`, 'iu'),
];

const normalizeLabel = (raw: string): string => raw.toLowerCase().replace(/[\s-]+/g, '');

const cutOut = (text: string, pattern: RegExp): { rest: string; label: string | null } => {
  const match = pattern.exec(text);
  if (!match || match[1] === undefined) return { rest: text, label: null };
  const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
  return { rest, label: normalizeLabel(match[1]) };
};

const tidy = (text: string): string => {
  let rest = text.replace(/\(\s*\)/g, ' ');
  // Непарная скобка остаётся от «(очередь 1)» — убираем скобки целиком.
  if ((rest.match(/\(/g) ?? []).length !== (rest.match(/\)/g) ?? []).length) rest = rest.replace(/[()]/g, ' ');
  return rest
    .replace(/\s*[,;]\s*(?=[,;]|$)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;—–-]+|[\s,;—–-]+$/gu, '')
    .trim();
};

export const parseProjectPath = (surface: string): IProjectPath => {
  let rest = surface.trim();
  let phase: string | null = null;
  let building: string | null = null;
  for (const pattern of BUILDING_PATTERNS) {
    const cut = cutOut(rest, pattern);
    if (cut.label !== null) {
      rest = cut.rest;
      building = cut.label;
      break;
    }
  }
  for (const pattern of PHASE_PATTERNS) {
    const cut = cutOut(rest, pattern);
    if (cut.label !== null) {
      rest = cut.rest;
      phase = cut.label;
      break;
    }
  }
  const complex = tidy(rest);
  // Если от названия ничего не осталось, это не иерархия, а неудачный разбор — оставляем как было.
  if (complex.length < 2 || (phase === null && building === null)) return { complex: surface.trim(), phase: null, building: null };
  return { complex, phase, building };
};
