// Настройки модели: локальный LM Studio (по умолчанию) или OpenRouter. Оба — OpenAI-совместимый /v1.
//
// Провайдер, ключ и маршрут проверяются вместе: облачный провайдер без ключа или по http
// конфигурацией не собирается. Значения в текст ошибок не попадают — рядом лежат секреты.

import { EnvValueError } from './parse.js';

export type LlmProvider = 'lmstudio' | 'openrouter';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Хостинг OpenRouter: провайдер (`deepinfra`) или его вариант с квантизацией (`deepinfra/fp8`). */
const ROUTE_PROVIDER_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?$/;

export const parseLlmProvider = (raw: string | undefined): LlmProvider => {
  const value = raw === undefined || raw.trim() === '' ? 'lmstudio' : raw.trim().toLowerCase();
  if (value !== 'lmstudio' && value !== 'openrouter') {
    throw new EnvValueError('LLM_PROVIDER: допустимо lmstudio (по умолчанию) или openrouter');
  }
  return value;
};

/** Адрес до разбора: у OpenRouter по умолчанию его API, а не локальный LM Studio. */
export const llmBaseUrlInput = (provider: LlmProvider, raw: string | undefined): string | undefined =>
  provider === 'openrouter' && (raw === undefined || raw.trim() === '') ? OPENROUTER_BASE_URL : raw;

export interface ILlmAccess {
  /** Пусто — запрос без заголовка Authorization. */
  apiKey: string;
  /** Только OpenRouter: хостинги по порядку, других не брать. Пусто — самый дешёвый подходящий. */
  routeProviders: readonly string[];
}

export const parseLlmAccess = (
  provider: LlmProvider,
  baseUrl: string,
  rawKey: string | undefined,
  rawRoute: string | undefined,
): ILlmAccess => {
  const apiKey = rawKey?.trim() ?? '';
  // Маршрут относится только к OpenRouter: оставленный в .env при возврате на LM Studio ни на что не влияет.
  if (provider === 'lmstudio') return { apiKey, routeProviders: [] };
  if (!baseUrl.startsWith('https://')) {
    throw new EnvValueError(
      `LMSTUDIO_BASE_URL: для openrouter — только https (${OPENROUTER_BASE_URL} или пусто), иначе ключ уйдёт открытым текстом`,
    );
  }
  if (apiKey === '') throw new EnvValueError('LLM_API_KEY: при LLM_PROVIDER=openrouter обязателен');
  const routeProviders = (rawRoute ?? '')
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => p !== '');
  if (routeProviders.some(p => !ROUTE_PROVIDER_RE.test(p))) {
    throw new EnvValueError('OPENROUTER_PROVIDERS: через запятую, вида deepinfra или deepinfra/fp8');
  }
  if (new Set(routeProviders).size !== routeProviders.length) {
    throw new EnvValueError('OPENROUTER_PROVIDERS: хостинг указан дважды');
  }
  return { apiKey, routeProviders };
};
