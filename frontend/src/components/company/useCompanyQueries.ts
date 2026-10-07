// Запросы карточки компании. Ключи общие для всех вкладок: «Сведения» и «Подробно» читают те же
// объекты, события, публикации и контрагентов — React Query отдаёт их из кэша, а не запрашивает дважды.
// Итоги (плитки, полосы, ряды по месяцам) — из тех же наборов, что списки (07.10.2026): снимок показателей
// карточка больше не читает.

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ICompanyBuildersResponse, ICompanyChecksResponse, ICompanyDelivery, ICompanyFinanceResponse, ICompanyObjectsResponse, ICompanyResponse, ICompanySummary, IEventRow, IEventStats, IFocusView, IPartnersResponse, IPublicationStats } from '../../api/types';

export interface ISimilarCompany {
  id: number;
  name: string;
  city: string | null;
  /** Пара стоит в очереди «возможный дубль» и модель её оценила; старый сервер поля не присылает. */
  modelVerdict?: 'same' | 'unsure' | null;
}

export const useCompany = (companyId: number, enabled: boolean): UseQueryResult<ICompanyResponse> =>
  useQuery({
    queryKey: ['company', companyId],
    queryFn: () => api.get<ICompanyResponse>(`/api/companies/${companyId}`),
    enabled,
  });

/** Объекты вкладки «Объекты» — свои и застройщиков группы, со сводкой ДОМ.РФ. Ключ общий с «Обзором». */
export const useCompanyObjects = (companyId: number, enabled = true): UseQueryResult<ICompanyObjectsResponse> =>
  useQuery({
    queryKey: ['company', companyId, 'objects'],
    queryFn: () => api.get<ICompanyObjectsResponse>(`/api/companies/${companyId}/objects`),
    enabled,
  });

/** «Кто строит для компании» (24D): генподрядчики из ДОМ.РФ и публикаций на объектах заказчика. */
export const useCompanyBuilders = (companyId: number): UseQueryResult<ICompanyBuildersResponse> =>
  useQuery({
    queryKey: ['company', companyId, 'builders'],
    queryFn: () => api.get<ICompanyBuildersResponse>(`/api/companies/${companyId}/builders`),
  });

/** Финансы и налоги (24B): карты снимков ГИР БО и «Прозрачного бизнеса». Ключ — для «Обновить». */
export const companyFinanceKey = (companyId: number): readonly unknown[] => ['company', companyId, 'finance'];

export const useCompanyFinance = (companyId: number): UseQueryResult<ICompanyFinanceResponse> =>
  useQuery({
    queryKey: companyFinanceKey(companyId),
    queryFn: () => api.get<ICompanyFinanceResponse>(`/api/companies/${companyId}/finance`),
  });

/** Суды, ФССП и банкротство (24C): карты снимков картотеки, ФССП и ЕФРСБ. */
export const companyChecksKey = (companyId: number): readonly unknown[] => ['company', companyId, 'registry-checks'];

/** Пока сервер получает карточки дел (суммы исков), блок перечитывается сам. */
const CLAIMS_POLL_MS = 10_000;

export const useCompanyChecks = (companyId: number): UseQueryResult<ICompanyChecksResponse> =>
  useQuery({
    queryKey: companyChecksKey(companyId),
    queryFn: () => api.get<ICompanyChecksResponse>(`/api/companies/${companyId}/registry-checks`),
    refetchInterval: q => (q.state.data?.claimsFetching ? CLAIMS_POLL_MS : false),
  });

/** Сроки и продажи по домам ДОМ.РФ (24E). */
export const useCompanyDelivery = (companyId: number): UseQueryResult<ICompanyDelivery> =>
  useQuery({
    queryKey: ['company', companyId, 'delivery'],
    queryFn: () => api.get<ICompanyDelivery>(`/api/companies/${companyId}/delivery`),
  });

/** События: последние 100 по дате события и общее число (total; у прежнего сервера его нет — тогда длина списка). */
export interface ICompanyEventsResponse {
  items: IEventRow[];
  total?: number;
  truncated?: boolean;
  /** Итоги по всему набору списка: плитка, виды и ряд по месяцам (у старого сервера нет). */
  stats?: IEventStats;
}

export const useCompanyEvents = (companyId: number): UseQueryResult<ICompanyEventsResponse> =>
  useQuery({
    queryKey: ['company', companyId, 'events'],
    queryFn: () => api.get<ICompanyEventsResponse>(`/api/companies/${companyId}/events`),
  });

export const useCompanySimilar = (companyId: number): UseQueryResult<{ items: ISimilarCompany[] }> =>
  useQuery({
    queryKey: ['company', companyId, 'similar'],
    queryFn: () => api.get<{ items: ISimilarCompany[] }>(`/api/companies/${companyId}/similar`),
  });

/** Итоги ленты публикаций: плитка «Публикации», полнота и происхождение текстов, ряд по месяцам. */
export const useCompanyPublicationStats = (companyId: number): UseQueryResult<IPublicationStats> =>
  useQuery({
    queryKey: ['company', companyId, 'publication-stats'],
    queryFn: () => api.get<IPublicationStats>(`/api/companies/${companyId}/publication-stats`),
  });

/** Контрагенты: limit строк и числа по полному набору (плитка «Связи», «С кем связана», «Участие и связи»). */
export const useCompanyPartners = (companyId: number, limit: number): UseQueryResult<IPartnersResponse> =>
  useQuery({
    queryKey: ['company', companyId, 'partners', limit],
    queryFn: () => api.get<IPartnersResponse>(`/api/companies/${companyId}/partners?limit=${limit}`),
  });

export const useCompanySummary = (companyId: number): UseQueryResult<ICompanySummary> =>
  useQuery({
    queryKey: ['company', companyId, 'dossier-summary'],
    queryFn: () => api.get<ICompanySummary>(`/api/companies/${companyId}/dossier-summary`),
  });

/** Сведения ЕГРЮЛ из Контур.Фокуса: шапка карточки и раздел «Подробно» читают один кэш. */
export const companyFocusKey = (companyId: number): readonly unknown[] => ['company', companyId, 'focus'];

export const useCompanyFocus = (companyId: number, enabled = true): UseQueryResult<IFocusView> =>
  useQuery({
    queryKey: companyFocusKey(companyId),
    queryFn: () => api.get<IFocusView>(`/api/companies/${companyId}/focus`),
    enabled,
  });
