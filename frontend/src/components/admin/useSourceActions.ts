// Действия с источником — одни и те же в таблице (широкий экран) и в карточках (телефон):
// включить или выключить, срок сбора, проверка сайта, удаление, подробности состояния.
//
// Допуск упрощён до «включить / выключить» (решение владельца 23.09.2026): одна кнопка
// разрешает сбор и ИИ-обработку вместе и ставит источник в расписание. Журнал допуска пишется
// так же, как у прежнего редактора; раздельные допуски остались в API (`PATCH /sources/:id/policy`).
//
// Ответ на действие — тост у нижнего края, а не баннер вверху страницы: на телефоне баннер
// оказывался за пределами экрана, и нажатие выглядело оставшимся без ответа.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ISiteProbeReport, ISourceRow } from '../../api/types';
import { sourceLabel } from '../../lib/labels';
import { useConfirm } from '../ui/confirm';
import { useToast } from '../ui/toast';
import { actionError } from './actionError';

/** Включён — значит собирается и разбирается: оба допуска действуют, опрос не на паузе. */
export const isSourceEnabled = (s: ISourceRow): boolean =>
  s.collectBlockedReason === null && s.aiBlockedReason === null && (s.kind === 'manual' || s.status !== 'paused');

/**
 * «Не собирается»: включён, но сбор сломан (изменилась вёрстка, канал закрыт). Выключенный
 * источник сюда не входит — это решение оператора, а не поломка.
 */
export const isSourceBroken = (s: ISourceRow): boolean => s.status === 'broken' && isSourceEnabled(s);

/** Название для людей: у канала без имени — «@ключ», а не голый технический ключ. */
export const sourceName = (s: ISourceRow): string => sourceLabel({ sourceTitle: s.title, sourceKey: s.key, sourceKind: s.kind });

/**
 * Удалить можно только источник без собранных публикаций: удаление с документами унесло бы
 * упоминания и события, а роли остались бы без цитат. Число неизвестно — кнопки нет.
 */
export const canDeleteSource = (s: ISourceRow): boolean => s.kind !== 'manual' && s.items === 0;

export interface IProbeResult {
  source: ISourceRow;
  report: ISiteProbeReport;
}

export interface ISourceActions {
  toggle: (s: ISourceRow, enabled: boolean) => void;
  isToggling: (s: ISourceRow) => boolean;
  setHistory: (s: ISourceRow, days: number | null) => void;
  isSettingHistory: (s: ISourceRow) => boolean;
  probe: (s: ISourceRow) => void;
  isProbing: (s: ISourceRow) => boolean;
  remove: (s: ISourceRow) => Promise<void>;
  isRemoving: (s: ISourceRow) => boolean;
  probeResult: IProbeResult | null;
  closeProbe: () => void;
  /** Подробности состояния — окном, а не раскрывашкой в строке: id источника, у которого оно открыто. */
  detailsId: number | null;
  openDetails: (s: ISourceRow) => void;
  closeDetails: () => void;
}

export const useSourceActions = (): ISourceActions => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [probeResult, setProbeResult] = useState<IProbeResult | null>(null);
  const [detailsId, setDetailsId] = useState<number | null>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['sources'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
    void queryClient.invalidateQueries({ queryKey: ['pipeline'] });
  };
  const fail = (err: Error): void => {
    toast.show({ tone: 'danger', text: actionError(err) });
  };

  const toggle = useMutation({
    mutationFn: ({ source, enabled }: { source: ISourceRow; enabled: boolean }) =>
      api.post(`/api/admin/sources/${source.id}/enabled`, { enabled }),
    onSuccess: (_result, { source, enabled }) => {
      toast.show({
        tone: enabled ? 'success' : 'neutral',
        text: enabled
          ? `«${sourceName(source)}» включён: сбор начнётся в ближайший проход, новые публикации уйдут в разбор.`
          : `«${sourceName(source)}» выключен: сбор и разбор остановлены, собранное остаётся.`,
      });
      invalidate();
    },
    onError: fail,
  });

  const history = useMutation({
    mutationFn: ({ source, days }: { source: ISourceRow; days: number | null }) =>
      api.put(`/api/admin/sources/${source.id}/history`, { days }),
    onSuccess: (_result, { days }) => {
      toast.show({
        tone: 'success',
        text:
          days === null ? 'Срок сбора снят.' : `Срок сбора — ${days} дн. История догружается в фоне, в прежнем темпе запросов к источнику.`,
      });
      invalidate();
    },
    onError: fail,
  });

  // Проверка включённого сайта: живой запрос по действию оператора, без записи.
  const probe = useMutation({
    mutationFn: (source: ISourceRow) => api.post<{ report: ISiteProbeReport }>(`/api/admin/sources/${source.id}/probe`),
    onSuccess: (result, source) => setProbeResult({ source, report: result.report }),
    onError: fail,
  });

  const removal = useMutation({
    mutationFn: (source: ISourceRow) => api.delete(`/api/admin/sources/${source.id}`),
    onSuccess: (_result, source) => {
      // Удалили из окна подробностей — окно закрывается сразу, а не когда список перезагрузится:
      // иначе тост об удалении оказался бы под его подложкой.
      setDetailsId(open => (open === source.id ? null : open));
      toast.show({ tone: 'success', text: `Источник «${sourceName(source)}» удалён.` });
      invalidate();
    },
    onError: fail,
  });

  const pendingFor =
    (mutation: { isPending: boolean; variables?: { id: number } | { source: ISourceRow } }) =>
    (s: ISourceRow): boolean => {
      if (!mutation.isPending || !mutation.variables) return false;
      const target = 'source' in mutation.variables ? mutation.variables.source : mutation.variables;
      return target.id === s.id;
    };

  return {
    toggle: (source, enabled) => toggle.mutate({ source, enabled }),
    isToggling: pendingFor(toggle),
    setHistory: (source, days) => history.mutate({ source, days }),
    isSettingHistory: pendingFor(history),
    probe: source => probe.mutate(source),
    isProbing: pendingFor(probe),
    remove: async source => {
      const ok = await confirm({
        title: `Удалить «${sourceName(source)}»?`,
        body: 'Публикаций из этого источника нет, поэтому из карточек ничего не пропадёт. Вернуть источник можно, только добавив его заново.',
        confirmLabel: 'Удалить',
        tone: 'danger',
      });
      if (ok) removal.mutate(source);
    },
    isRemoving: pendingFor(removal),
    probeResult,
    closeProbe: () => setProbeResult(null),
    detailsId,
    openDetails: source => setDetailsId(source.id),
    closeDetails: () => setDetailsId(null),
  };
};
