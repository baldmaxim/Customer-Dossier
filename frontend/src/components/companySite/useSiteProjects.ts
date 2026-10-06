// Проекты с подтверждённых сайтов компании (25B): один кэш на вкладку «Объекты» и строку на «Сведениях».

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ICompanySiteProjects } from '../../api/types';

export const siteProjectsKey = (companyId: number): readonly unknown[] => ['company', companyId, 'site-projects'];

export const useSiteProjects = (companyId: number, enabled = true): UseQueryResult<ICompanySiteProjects> =>
  useQuery({
    queryKey: siteProjectsKey(companyId),
    queryFn: () => api.get<ICompanySiteProjects>(`/api/companies/${companyId}/site-projects`),
    enabled,
  });
