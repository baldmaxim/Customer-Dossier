// Правила логина, имени и пароля — те же, что на сервере (backend/src/auth/service.ts: loginProblem,
// displayNameProblem; auth/password.ts: passwordProblem). Сервер проверяет всё сам; здесь — чтобы
// не гонять запрос ради опечатки и показать ошибку у нужного поля. Тексты имени и пароля — серверные;
// у логина — точнее серверного: общее правило уже написано в подсказке к полю.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;
export const DISPLAY_NAME_MAX_LENGTH = 120;

/** Логин — латиница в нижнем регистре, цифры и `._@-`; почта подходит. Тот же, что LOGIN_RE сервера. */
export const LOGIN_RE = /^[a-z0-9][a-z0-9._@-]{2,63}$/;

/** Системные исполнители в журналах: такой логин путал бы атрибуцию. */
const RESERVED_LOGINS: ReadonlySet<string> = new Set(['operator', 'system', 'cli', 'anonymous', 'registry', 'test-suite']);

/** Как логин хранит сервер: без пробелов по краям, в нижнем регистре. */
export const normalizeLogin = (raw: string): string => raw.trim().toLowerCase();

/** login — уже нормализованный (normalizeLogin). Что именно не так — по шагам правила LOGIN_RE. */
export const loginProblem = (login: string): string | null => {
  if (login === '') return 'Укажите логин';
  if (/[^a-z0-9._@-]/.test(login)) return 'Только латинские буквы, цифры, точка, дефис, подчёркивание и @ — без пробелов';
  if (!/^[a-z0-9]/.test(login)) return 'Логин начинается с латинской буквы или цифры';
  if (login.length < 3) return 'Логин — не короче 3 знаков';
  if (login.length > 64) return 'Логин — не длиннее 64 знаков';
  // Страховка: шаги выше обязаны давать то же, что правило сервера (accountRules.test.ts).
  if (!LOGIN_RE.test(login)) return 'Логин — от 3 до 64 символов: латинские буквы, цифры, точка, дефис, подчёркивание, @';
  if (RESERVED_LOGINS.has(login)) return 'Этот логин зарезервирован системой';
  return null;
};

export const displayNameProblem = (name: string): string | null => {
  if (name.length < 1 || name.length > DISPLAY_NAME_MAX_LENGTH) return `Имя — от 1 до ${DISPLAY_NAME_MAX_LENGTH} символов`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'Имя содержит управляющие символы';
  return null;
};

/** login — уже нормализованный; пустой логин проверку «без логина внутри» не запускает. */
export const passwordProblem = (password: string, login: string): string | null => {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return `Пароль — не короче ${PASSWORD_MIN_LENGTH} символов`;
  if (length > PASSWORD_MAX_LENGTH) return `Пароль — не длиннее ${PASSWORD_MAX_LENGTH} символов`;
  if (password.trim() === '') return 'Пароль не может состоять из одних пробелов';
  if (login !== '' && password.toLowerCase().includes(login.toLowerCase())) return 'Пароль не должен содержать логин';
  if (new Set(password).size < 4) return 'В пароле слишком мало разных символов';
  return null;
};
