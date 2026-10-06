// Состояние parser-api.com — один запрос на страницу сервиса и вход с «Сайтов» (этап 24A).

import { api } from '../../api/client';
import type { IParserApiSettings } from '../../api/types';

export const PARSER_API_SETTINGS_KEY = ['parser-api-settings'];

export const parserApiSettingsQuery = {
  queryKey: PARSER_API_SETTINGS_KEY,
  queryFn: () => api.get<IParserApiSettings>('/api/admin/parser-api'),
};
