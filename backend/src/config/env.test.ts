// TC-010: строгий разбор флагов и безопасные значения по умолчанию.

import { describe, it, expect } from 'vitest';

import { parseEnv } from './env.js';
import { EnvValueError, parseListenHost, parsePublicOrigin, parseStrictBool } from './parse.js';

const base = { DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x' };

describe('parseStrictBool (TC-010)', () => {
  it('принимает только true/false/1/0 в любом регистре', () => {
    expect(parseStrictBool('X', 'true', false)).toBe(true);
    expect(parseStrictBool('X', 'TRUE', false)).toBe(true);
    expect(parseStrictBool('X', '1', false)).toBe(true);
    expect(parseStrictBool('X', 'false', true)).toBe(false);
    expect(parseStrictBool('X', '0', true)).toBe(false);
    expect(parseStrictBool('X', ' False ', true)).toBe(false);
  });

  it('пустое значение — значение по умолчанию', () => {
    expect(parseStrictBool('X', undefined, false)).toBe(false);
    expect(parseStrictBool('X', '', true)).toBe(true);
    expect(parseStrictBool('X', '   ', false)).toBe(false);
  });

  it('любое другое значение — ошибка, а не молчаливое true', () => {
    // Раньше всё, кроме "false", становилось true: "0", "no", "off", опечатка.
    for (const bad of ['no', 'off', 'yes', 'on', 'ture', '2', 'false;']) {
      expect(() => parseStrictBool('INGEST_ENABLED', bad, false), bad).toThrow(EnvValueError);
    }
  });

  it('текст ошибки не содержит само значение', () => {
    try {
      parseStrictBool('X', 'secret-like-value', false);
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('secret-like-value');
    }
  });
});

describe('parseEnv — фоновые задания и сеть (TC-001, TC-010)', () => {
  // Решение владельца 21.09.2026: поток «сбор → разбор → публикация» идёт сам.
  // Бот и применение слияний остаются выключенными: бот без токена бессмыслен,
  // слияние необратимо.
  it('без явных флагов поток работает, а бот и слияние — нет', () => {
    const env = parseEnv(base);
    expect(env.INGEST_ENABLED).toBe(true);
    expect(env.PIPELINE_ENABLED).toBe(true);
    expect(env.METRICS_AUTO_REFRESH).toBe(true);
    expect(env.REPROCESS_AUTO_PUBLISH).toBe(true);
    expect(env.BOT_ENABLED).toBe(false);
    expect(env.MERGE_APPLY_ENABLED).toBe(false);
  });

  // Упавший разбор раньше не возвращался в поток никогда: чинить приходилось руками.
  it('повтор упавшего разбора включён, с потолком попыток и паузой', () => {
    const env = parseEnv(base);
    expect(env.REPROCESS_RETRY_ENABLED).toBe(true);
    expect(env.REPROCESS_RETRY_MAX).toBe(3);
    expect(env.REPROCESS_RETRY_BACKOFF_MIN).toBe(15);
    expect(parseEnv({ ...base, REPROCESS_RETRY_ENABLED: 'false' }).REPROCESS_RETRY_ENABLED).toBe(false);
  });

  it('каждый флаг остаётся рубильником: =false выключает', () => {
    const env = parseEnv({
      ...base,
      INGEST_ENABLED: 'false',
      PIPELINE_ENABLED: 'false',
      METRICS_AUTO_REFRESH: 'false',
      REPROCESS_AUTO_PUBLISH: 'false',
    });
    expect(env.INGEST_ENABLED).toBe(false);
    expect(env.PIPELINE_ENABLED).toBe(false);
    expect(env.METRICS_AUTO_REFRESH).toBe(false);
    expect(env.REPROCESS_AUTO_PUBLISH).toBe(false);
  });

  it('флаг "0" не включает задание', () => {
    const env = parseEnv({ ...base, INGEST_ENABLED: '0', BOT_ENABLED: '0' });
    expect(env.INGEST_ENABLED).toBe(false);
    expect(env.BOT_ENABLED).toBe(false);
  });

  it('невалидный флаг останавливает запуск', () => {
    expect(() => parseEnv({ ...base, PIPELINE_ENABLED: 'maybe' })).toThrow(EnvValueError);
  });

  it('API по умолчанию слушает только loopback', () => {
    expect(parseEnv(base).HOST).toBe('127.0.0.1');
  });

  it('0.0.0.0 и адрес в сети запрещены', () => {
    expect(() => parseListenHost('0.0.0.0')).toThrow(EnvValueError);
    expect(() => parseListenHost('192.168.1.10')).toThrow(EnvValueError);
    expect(() => parseListenHost('::')).toThrow(EnvValueError);
    expect(parseListenHost('localhost')).toBe('localhost');
    expect(parseListenHost('::1')).toBe('::1');
  });

  it('DATABASE_SSL=0 теперь действительно выключает SSL', () => {
    expect(parseEnv({ ...base, DATABASE_SSL: '0' }).DATABASE_SSL).toBe(false);
  });
});

describe('адрес локальной модели (TC-007)', () => {
  it('loopback LM Studio разрешён: это доверенный фиксированный endpoint', () => {
    expect(parseEnv({ ...base, LMSTUDIO_BASE_URL: 'http://127.0.0.1:1234/v1/' }).LMSTUDIO_BASE_URL).toBe(
      'http://127.0.0.1:1234/v1',
    );
    expect(parseEnv({ ...base, LMSTUDIO_BASE_URL: 'http://localhost:1234/v1' }).LMSTUDIO_BASE_URL).toBe(
      'http://localhost:1234/v1',
    );
  });

  it('логин и пароль в адресе модели запрещены', () => {
    expect(() => parseEnv({ ...base, LMSTUDIO_BASE_URL: 'http://u:p@127.0.0.1:1234/v1' })).toThrow(EnvValueError);
  });
});

describe('вход оператора и серверная выкладка (ADR-013)', () => {
  const TOKEN = 'x'.repeat(32);
  const server = { ...base, AUTH_MODE: 'token', OPERATOR_TOKEN: TOKEN, HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://radar.example.ru' };

  it('по умолчанию входа нет и токен не читается', () => {
    const env = parseEnv({ ...base, OPERATOR_TOKEN: 'short' });
    expect(env.AUTH_MODE).toBe('none');
    expect(env.OPERATOR_TOKEN).toBeNull();
    expect(env.PUBLIC_ORIGIN).toBeNull();
    expect(env.TRUST_PROXY).toBe(false);
  });

  it('неизвестный режим входа — ошибка старта', () => {
    expect(() => parseEnv({ ...base, AUTH_MODE: 'password' })).toThrow(EnvValueError);
  });

  it('AUTH_MODE=token требует токен не короче 32 символов, текст ошибки без значения', () => {
    expect(() => parseEnv({ ...server, OPERATOR_TOKEN: '' })).toThrow(EnvValueError);
    try {
      parseEnv({ ...server, OPERATOR_TOKEN: 'short-secret-value' });
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('short-secret-value');
    }
    expect(parseEnv(server).OPERATOR_TOKEN).toBe(TOKEN);
  });

  it('адрес в сети — только со входом: сеть без входа конфигурацией не собирается', () => {
    expect(() => parseEnv({ ...base, HOST: '0.0.0.0' })).toThrow(EnvValueError);
    expect(parseEnv(server).HOST).toBe('0.0.0.0');
    expect(parseListenHost('::', true)).toBe('::');
    expect(() => parseListenHost('radar.example.ru', true)).toThrow(EnvValueError);
  });

  it('публичный адрес вне loopback — только https и только со входом', () => {
    expect(() => parseEnv({ ...base, PUBLIC_ORIGIN: 'https://radar.example.ru' })).toThrow(EnvValueError);
    expect(() => parseEnv({ ...server, PUBLIC_ORIGIN: 'http://radar.example.ru' })).toThrow(EnvValueError);
    expect(parseEnv({ ...server, PUBLIC_ORIGIN: 'https://radar.example.ru/' }).PUBLIC_ORIGIN).toBe('https://radar.example.ru');
    expect(parsePublicOrigin('http://127.0.0.1:8080', 'none')).toBe('http://127.0.0.1:8080');
    // Регистр имени — не ошибка: Host сравнивается без учёта регистра.
    expect(parsePublicOrigin('https://Radar.Example.ru', 'token')).toBe('https://radar.example.ru');
  });

  it('публичный адрес — без пути, логина и параметров', () => {
    for (const bad of ['https://radar.example.ru/app', 'https://u:p@radar.example.ru', 'https://radar.example.ru?x=1', 'https://radar.example.ru#x', 'ftp://radar.example.ru', 'не адрес']) {
      expect(() => parsePublicOrigin(bad, 'token'), bad).toThrow(EnvValueError);
    }
  });
});
