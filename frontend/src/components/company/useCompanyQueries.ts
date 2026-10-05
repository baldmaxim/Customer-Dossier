// Запросы карточки компании. Ключи общие для всех вкладок: «Обзор» и «Подробно» читают те же
// объекты, события и показатели — React Query отдаёт их из кэша, а не запрашивает дважды.

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ICompanyObjectsResponse, ICompanyResponse, ICompanySummary, IEventRow, IFocusView, IProjectRow, ISignalsResponse } from '../../api/types';

export interface ISimilarCompany {
  id: number;
  name: string;
  city: string | null;
}

export const useCompany = (companyId: number, enabled: boolean): UseQueryResult<ICompanyResponse> =>
  useQuery({
    queryKey: ['company', companyId],
    queryFn: () => api.get<ICompanyResponse>(`/api/companies/${companyId}`),
    enabled,
  });

export const useCompanyProjects = (companyId: number): UseQueryResult<{ items: IProjectRow[] }> =>
  useQuery({
    queryKey: ['company', companyId, 'projects'],
    queryFn: () => api.get<{ items: IProjectRow[] }>(`/api/companies/${companyId}/projects`),
  });

/** Объекты вкладки «Объекты» — свои и застройщиков группы, со сводкой ДОМ.РФ. Ключ общий с «Обзором». */
export const useCompanyObjects = (companyId: number, enabled = true): UseQueryResult<ICompanyObjectsResponse> =>
  useQuery({
    queryKey: ['company', companyId, 'objects'],
    queryFn: () => api.get<ICompanyObjectsResponse>(`/api/companies/${companyId}/objects`),
    enabled,
  });

/** События: последние 100 по дате события и общее число (total; у прежнего сервера его нет — тогда длина списка). */
export interface ICompanyEventsResponse {
  items: IEventRow[];
  total?: number;
  truncated?: boolean;
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

export const useCompanySignals = (companyId: number): UseQueryResult<ISignalsResponse> =>
  useQuery({
    queryKey: ['company', companyId, 'signals'],
    queryFn: () => api.get<ISignalsResponse>(`/api/companies/${companyId}/signals`),
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
