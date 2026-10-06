// Сайты компаний (этап 25A): сводка — один запрос на вход с «Сайтов» и шапку страницы очереди.

import { api } from '../../api/client';
import type { ICompanySitesList } from '../../api/types';

export const COMPANY_SITES_SUMMARY_KEY = ['company-sites', 'summary'];

export type ICompanySitesSummary = Pick<ICompanySitesList, 'mode' | 'dailyLimit' | 'totals'>;

export const companySitesSummaryQuery = {
  queryKey: COMPANY_SITES_SUMMARY_KEY,
  queryFn: () => api.get<ICompanySitesSummary>('/api/admin/company-sites/summary'),
};
