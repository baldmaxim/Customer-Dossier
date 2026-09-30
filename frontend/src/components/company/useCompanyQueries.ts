// Запросы карточки компании. Ключи общие для всех вкладок: «Обзор» и «Подробно» читают те же
// объекты, события и показатели — React Query отдаёт их из кэша, а не запрашивает дважды.

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ICompanyResponse, ICompanySummary, IEventRow, IProjectRow, ISignalsResponse } from '../../api/types';

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

export const useCompanyEvents = (companyId: number): UseQueryResult<{ items: IEventRow[] }> =>
  useQuery({
    queryKey: ['company', companyId, 'events'],
    queryFn: () => api.get<{ items: IEventRow[] }>(`/api/companies/${companyId}/events`),
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
