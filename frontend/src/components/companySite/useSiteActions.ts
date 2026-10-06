// Решения оператора по сайтам компаний (этап 25A): одни и те же на карточке компании и на странице
// «Сайты компаний» — после решения обновляются оба экрана.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ISiteCandidate, SiteSearchMode } from '../../api/types';
import { useConfirm } from '../ui/confirm';
import { useToast } from '../ui/toast';
import { actionError } from '../admin/actionError';

export const COMPANY_SITES_KEY = ['company-sites'] as const;

export const companySiteKey = (companyId: number): readonly unknown[] => ['company', companyId, 'site'];

export interface ISiteActions {
  confirm: (candidate: ISiteCandidate) => void;
  /** «Не он» у ждущего решения; у подтверждённого — с вопросом: сайт отвязывается от компании. */
  reject: (candidate: ISiteCandidate) => Promise<void>;
  manual: (companyId: number, url: string) => void;
  search: (companyId: number) => void;
  busy: boolean;
}

export const useSiteActions = (): ISiteActions => {
  const client = useQueryClient();
  const toast = useToast();
  const ask = useConfirm();

  const refresh = (companyId: number): void => {
    void client.invalidateQueries({ queryKey: COMPANY_SITES_KEY });
    void client.invalidateQueries({ queryKey: companySiteKey(companyId) });
  };
  const done = (text: string, companyId: number): void => {
    toast.show({ tone: 'success', text });
    refresh(companyId);
  };
  const fail = (err: Error): void => {
    toast.show({ tone: 'danger', text: actionError(err) });
  };

  const confirm = useMutation({
    mutationFn: (candidate: ISiteCandidate) => api.post(`/api/admin/company-site-candidates/${candidate.id}/confirm`, {}),
    onSuccess: (_result, candidate) => done(`${candidate.host} — сайт компании.`, candidate.companyId),
    onError: fail,
  });
  const reject = useMutation({
    mutationFn: (candidate: ISiteCandidate) => api.post(`/api/admin/company-site-candidates/${candidate.id}/reject`, {}),
    onSuccess: (_result, candidate) => done(`${candidate.host} — не сайт компании: при повторном поиске не вернётся.`, candidate.companyId),
    onError: fail,
  });
  const manual = useMutation({
    mutationFn: (input: { companyId: number; url: string }) => api.post(`/api/admin/company-sites/${input.companyId}/manual`, { url: input.url }),
    onSuccess: (_result, input) => done('Сайт привязан. Портал проверит его в течение минуты.', input.companyId),
    onError: fail,
  });
  const search = useMutation({
    mutationFn: (companyId: number) => api.post<{ queued: boolean; mode: SiteSearchMode }>(`/api/admin/company-sites/${companyId}/search`, {}),
    onSuccess: (result, companyId) =>
      done(result.mode === 'on' ? 'Компания — первая в очереди поиска сайта.' : 'Компания в очереди; поиск пойдёт, когда его включат.', companyId),
    onError: fail,
  });

  return {
    confirm: candidate => confirm.mutate(candidate),
    reject: async candidate => {
      if (candidate.state === 'confirmed') {
        const ok = await ask({
          title: `Отвязать ${candidate.host}?`,
          body: 'Сайт перестанет считаться сайтом компании и при повторном поиске не вернётся.',
          confirmLabel: 'Отвязать',
        });
        if (!ok) return;
      }
      reject.mutate(candidate);
    },
    manual: (companyId, url) => manual.mutate({ companyId, url }),
    search: companyId => search.mutate(companyId),
    busy: confirm.isPending || reject.isPending || manual.isPending || search.isPending,
  };
};
