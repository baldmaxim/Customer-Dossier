// Строгий разбор значений окружения.
//
// Раньше булевы флаги считались «всё, кроме false — истина»: опечатка, `0`
// или `no` молча включали поведение. Для флагов фоновых заданий это значит
// неожиданный сетевой сбор и запись в базу, поэтому неверное значение —
// ошибка запуска, а не догадка.

import net from 'node:net';

const TRUE_VALUES = new Set(['true', '1']);
const FALSE_VALUES = new Set(['false', '0']);

export class EnvValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValueError';
  }
}

/** Пустое или отсутствующее значение — fallback; иначе только true/false/1/0. */
export const parseStrictBool = (name: string, raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  // Значение в текст ошибки не попадает: в env рядом лежат секреты, и
  // перепутанная строка может оказаться токеном.
  throw new EnvValueError(`${name}: допустимы только true, false, 1 или 0`);
};

export const parsePositiveInt = (name: string, raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new EnvValueError(`${name} должен быть положительным целым числом`);
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new EnvValueError(`${name} должен быть положительным целым числом`);
  }
  return n;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export const isLoopbackHost = (host: string): boolean => {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(h) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
};

/**
 * Адрес, на котором слушает API. Без входа (AUTH_MODE=none) — только loopback: портал
 * рассчитан на одного оператора на этой же машине. Адрес в сети разрешён только вместе
 * со входом оператора (серверная выкладка, ADR-013): «сеть без входа» конфигурацией
 * не собирается.
 */
export const parseListenHost = (raw: string | undefined, allowNetwork = false): string => {
  const host = raw === undefined || raw.trim() === '' ? '127.0.0.1' : raw.trim();
  if (isLoopbackHost(host)) return host;
  if (!allowNetwork) {
    throw new EnvValueError(
      'HOST: без входа оператора (AUTH_MODE=none) разрешён только loopback (127.0.0.1, ::1, localhost). ' +
        'Адрес в сети — только с AUTH_MODE=token.',
    );
  }
  if (net.isIP(host) === 0) {
    throw new EnvValueError('HOST: адрес в сети задаётся IP-адресом (например 0.0.0.0 в контейнере)');
  }
  return host;
};

/** Адрес локальной модели: http(s) без логина и пароля в URL. */
export const parseLlmBaseUrl = (raw: string | undefined): string => {
  const value = raw === undefined || raw.trim() === '' ? 'http://127.0.0.1:1234/v1' : raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EnvValueError('LMSTUDIO_BASE_URL: некорректный адрес');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EnvValueError('LMSTUDIO_BASE_URL: допустимы только http и https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new EnvValueError('LMSTUDIO_BASE_URL: логин и пароль в адресе не допускаются');
  }
  return value.replace(/\/+$/, '');
};

export type AuthMode = 'none' | 'token';

/** Вход оператора: none (по умолчанию, локальная работа) или token (серверная выкладка). */
export const parseAuthMode = (raw: string | undefined): AuthMode => {
  const value = raw === undefined || raw.trim() === '' ? 'none' : raw.trim().toLowerCase();
  if (value !== 'none' && value !== 'token') {
    throw new EnvValueError('AUTH_MODE: допустимо none (по умолчанию) или token');
  }
  return value;
};

/** Токен оператора читается только при AUTH_MODE=token: обязателен и не короче 32 символов. */
export const parseOperatorToken = (mode: AuthMode, raw: string | undefined): string | null => {
  if (mode === 'none') return null;
  const token = raw?.trim() ?? '';
  if (token.length < 32) {
    throw new EnvValueError('OPERATOR_TOKEN: при AUTH_MODE=token обязателен и не короче 32 символов');
  }
  return token;
};

/**
 * Публичный адрес портала за обратным прокси: только схема, хост и порт. Его хост
 * становится допустимым Host, а сам адрес — допустимым Origin. Вне loopback — только
 * https (cookie сессии уходит с флагом Secure) и только со входом оператора.
 */
export const parsePublicOrigin = (raw: string | undefined, mode: AuthMode): string | null => {
  if (raw === undefined || raw.trim() === '') return null;
  const value = raw.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EnvValueError('PUBLIC_ORIGIN: некорректный адрес');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EnvValueError('PUBLIC_ORIGIN: допустимы только http и https');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new EnvValueError('PUBLIC_ORIGIN: только схема, хост и порт — без пути, логина и параметров');
  }
  if (!isLoopbackHost(url.hostname)) {
    if (mode !== 'token') {
      throw new EnvValueError('PUBLIC_ORIGIN вне loopback требует AUTH_MODE=token: без входа портал наружу не выставляется');
    }
    if (url.protocol !== 'https:') {
      throw new EnvValueError('PUBLIC_ORIGIN вне loopback — только https');
    }
  }
  return url.origin;
};
