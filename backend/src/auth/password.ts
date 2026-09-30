// Пароли: scrypt из node:crypto, без внешних зависимостей (ADR-014).
//
// Строка хеша несёт параметры: `scrypt$ln=14,r=8,p=5$<соль>$<хеш>`. Усилить параметры можно
// без миграции — needsRehash() сообщит об этом при следующем успешном входе, и хеш
// перепишется новым.
//
// Параметры — вариант OWASP для scrypt при ограниченной памяти: N=2^14, r=8, p=5 (16 МиБ
// на вычисление). Сервер делит 4 ГБ с соседним порталом, у API предел 448 МБ; вариант
// N=2^17 (128 МиБ) при нескольких одновременных входах вывел бы контейнер за предел.

import crypto from 'node:crypto';

interface IScryptParams {
  ln: number;
  r: number;
  p: number;
}

export const CURRENT_PARAMS: Readonly<IScryptParams> = { ln: 14, r: 8, p: 5 };
const KEY_LEN = 32;
const SALT_LEN = 16;
// 128 * N * r байт плюс запас: при значении по умолчанию (32 МиБ) Node отказывает уже на N=2^15.
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

const scrypt = (password: string, salt: Buffer, params: IScryptParams): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.scrypt(
      password.normalize('NFC'),
      salt,
      KEY_LEN,
      { N: 2 ** params.ln, r: params.r, p: params.p, maxmem: MAX_MEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });

const format = (params: IScryptParams, salt: Buffer, key: Buffer): string =>
  `scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;

interface IParsedHash {
  params: IScryptParams;
  salt: Buffer;
  key: Buffer;
}

const HASH_RE = /^scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

/** Разбор строки хеша. Параметры ограничены: испорченная строка в базе не должна занять весь процессор. */
const parse = (stored: string): IParsedHash | null => {
  const m = HASH_RE.exec(stored);
  if (!m) return null;
  const params = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  if (params.ln < 10 || params.ln > 16 || params.r < 1 || params.r > 16 || params.p < 1 || params.p > 16) return null;
  const salt = Buffer.from(m[4] ?? '', 'base64url');
  const key = Buffer.from(m[5] ?? '', 'base64url');
  if (salt.length < 16 || key.length !== KEY_LEN) return null;
  return { params, salt, key };
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.randomBytes(SALT_LEN);
  return format(CURRENT_PARAMS, salt, await scrypt(password, salt, CURRENT_PARAMS));
};

/** Неразборчивая строка хеша — отказ, а не исключение: вход просто не состоится. */
export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parsed = parse(stored);
  if (!parsed) return false;
  const key = await scrypt(password, parsed.salt, parsed.params);
  return crypto.timingSafeEqual(key, parsed.key);
};

export const needsRehash = (stored: string): boolean => {
  const parsed = parse(stored);
  return (
    parsed === null ||
    parsed.params.ln !== CURRENT_PARAMS.ln ||
    parsed.params.r !== CURRENT_PARAMS.r ||
    parsed.params.p !== CURRENT_PARAMS.p
  );
};

let dummy: Promise<string> | null = null;

/**
 * Хеш, с которым сравнивается пароль несуществующего пользователя. Без него ответ на чужой логин
 * приходил бы быстрее, чем на существующий, — и по времени можно было бы перебрать логины.
 */
export const dummyHash = (): Promise<string> => {
  dummy ??= hashPassword(crypto.randomBytes(24).toString('base64url'));
  return dummy;
};

/** Правило пароля. Текст — для человека; сам пароль в текст не попадает. */
export const passwordProblem = (password: string, login: string): string | null => {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return `Пароль — не короче ${PASSWORD_MIN_LENGTH} символов`;
  if (length > PASSWORD_MAX_LENGTH) return `Пароль — не длиннее ${PASSWORD_MAX_LENGTH} символов`;
  if (password.trim() === '') return 'Пароль не может состоять из одних пробелов';
  if (password.toLowerCase().includes(login.toLowerCase())) return 'Пароль не должен содержать логин';
  if (new Set(password).size < 4) return 'В пароле слишком мало разных символов';
  return null;
};

/** Временный пароль для консоли: 128 бит, без похожих символов не заботимся — его копируют, а не читают. */
export const generatePassword = (): string => crypto.randomBytes(16).toString('base64url');
