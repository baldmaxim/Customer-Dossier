// Защита локального API, не связанная со входом оператора.
//
// Вход по токену снят на время разработки, но эти две проверки остаются: они
// защищают не от постороннего человека, а от чужой страницы в браузере
// оператора. CORS авторизацией не является и здесь ничего не решает.

import { type RequestHandler, type Response } from 'express';

import { isLoopbackHost } from '../config/parse.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const deny = (res: Response, status: number, error: string, code: string): void => {
  res.status(status).json({ error, code });
};

/**
 * Host обязан быть loopback. Страница злоумышленника, чей домен после загрузки
 * начал резолвиться в 127.0.0.1 (DNS rebinding), шлёт Host со своим доменом —
 * такой запрос отклоняется до любого обработчика.
 */
export const requireLoopbackHost: RequestHandler = (req, res, next) => {
  const host = req.headers.host ?? '';
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0] ?? '';
  if (!isLoopbackHost(hostname)) {
    deny(res, 403, 'Запрос к API разрешён только по локальному адресу', 'bad_host');
    return;
  }
  next();
};

/** Чужой Origin отклоняется всегда; для изменяющих запросов проверяется и Sec-Fetch-Site. */
export const createOriginGuard =
  (allowedOrigins: readonly string[]): RequestHandler =>
  (req, res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      deny(res, 403, 'Запрос с чужой страницы отклонён', 'bad_origin');
      return;
    }
    if (origin === undefined && UNSAFE_METHODS.has(req.method)) {
      const site = req.headers['sec-fetch-site'];
      if (site !== undefined && site !== 'same-origin' && site !== 'none') {
        deny(res, 403, 'Запрос с чужой страницы отклонён', 'bad_origin');
        return;
      }
    }
    next();
  };
