// Состояние Контур.Фокуса — один запрос на страницу Фокуса и вход с «Сайтов».

import { api } from '../../api/client';
import type { IFocusSettings } from '../../api/types';

export const FOCUS_SETTINGS_KEY = ['focus-settings'];

export const focusSettingsQuery = {
  queryKey: FOCUS_SETTINGS_KEY,
  queryFn: () => api.get<IFocusSettings>('/api/admin/focus'),
};
