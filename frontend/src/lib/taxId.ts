// Реквизит в строке поиска: ИНН (10/12 цифр), ОГРН (13), ОГРНИП (15) — и сходится ли контрольная сумма.
// Те же правила, что у сервера (backend/src/resolve/normalize.ts): экран не предлагает завести компанию
// по реквизиту с опечаткой, а сервер всё равно проверяет сам.

export type QueryIdentifierType = 'inn' | 'ogrn' | 'ogrnip';

export interface IQueryIdentifier {
  type: QueryIdentifierType;
  value: string;
  /** «ИНН 7707083893». */
  label: string;
  checksumOk: boolean;
}

const INN10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12_11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12_12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

const mod11 = (digits: readonly number[], weights: readonly number[]): number =>
  (weights.reduce((sum, w, i) => sum + w * (digits[i] ?? 0), 0) % 11) % 10;

export const isValidInn = (value: string): boolean => {
  const d = [...value].map(Number);
  if (d.length === 10) return mod11(d, INN10) === d[9];
  if (d.length === 12) return mod11(d, INN12_11) === d[10] && mod11(d, INN12_12) === d[11];
  return false;
};

export const isValidOgrn = (value: string): boolean => {
  if (value.length !== 13 && value.length !== 15) return false;
  const body = BigInt(value.slice(0, -1));
  const check = Number(body % BigInt(value.length === 13 ? 11 : 13)) % 10;
  return check === Number(value.slice(-1));
};

const LABELS: Record<QueryIdentifierType, string> = { inn: 'ИНН', ogrn: 'ОГРН', ogrnip: 'ОГРНИП' };

/** Запрос целиком — реквизит (пробелы и дефисы допустимы); иначе null. */
export const identifierOfQuery = (query: string): IQueryIdentifier | null => {
  const value = query.replace(/[\s-]/g, '');
  if (!/^[0-9]+$/.test(value)) return null;
  const type: QueryIdentifierType | null =
    value.length === 10 || value.length === 12 ? 'inn' : value.length === 13 ? 'ogrn' : value.length === 15 ? 'ogrnip' : null;
  if (!type) return null;
  const checksumOk = type === 'inn' ? isValidInn(value) : isValidOgrn(value);
  return { type, value, label: `${LABELS[type]} ${value}`, checksumOk };
};
