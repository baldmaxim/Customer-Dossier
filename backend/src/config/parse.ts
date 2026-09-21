// Строгий разбор значений окружения.
//
// Раньше булевы флаги считались «всё, кроме false — истина»: опечатка, `0`
// или `no` молча включали поведение. Для флагов фоновых заданий это значит
// неожиданный сетевой сбор и запись в базу, поэтому неверное значение —
// ошибка запуска, а не догадка.

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
 * Адрес, на котором слушает API. Только loopback: портал рассчитан на одного
 * оператора на этой же машине. Открытие в LAN — отдельный будущий этап с
 * другой моделью доступа, а не значение переменной.
 */
export const parseListenHost = (raw: string | undefined): string => {
  const host = raw === undefined || raw.trim() === '' ? '127.0.0.1' : raw.trim();
  if (!isLoopbackHost(host)) {
    throw new EnvValueError(
      'HOST: разрешён только loopback (127.0.0.1, ::1, localhost). ' +
        'Доступ из сети в этой версии не поддерживается.',
    );
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
