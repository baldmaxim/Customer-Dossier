// Сводка страницы ДОМ.РФ — один запрос на вкладки страницы, вход с «Сайтов» и панель подсказок.

import { api } from '../../api/client';
import type { IDomRfSummary } from '../../api/types';

export const DOMRF_SUMMARY_KEY = ['domrf-summary'];

export const domRfSummaryQuery = {
  queryKey: DOMRF_SUMMARY_KEY,
  queryFn: () => api.get<IDomRfSummary>('/api/admin/domrf-summary'),
  refetchInterval: 30_000,
};

/** Ключ источника наш.дом.рф (как в sources.key, punycode). */
export const DOMRF_HOST = 'xn--80az8a.xn--d1aqf.xn--p1ai';

/** Адрес страницы ДОМ.РФ в админке. */
export const DOMRF_PAGE_PATH = '/admin/sources/domrf';
