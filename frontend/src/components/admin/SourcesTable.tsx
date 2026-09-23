// Таблица источников одного вида: включён ли, за какой срок собирать, в каком состоянии.
//
// Допуск упрощён до «включить / выключить» (решение владельца 23.09.2026): одна кнопка
// разрешает сбор и ИИ-обработку вместе и ставит источник в расписание. Журнал допуска
// пишется так же, как у прежнего редактора с основанием и ответственным; сам редактор
// с экрана снят, раздельные допуски остались в API (`PATCH /sources/:id/policy`).

import { FC, Fragment, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ISiteProbeReport, ISourceRow } from '../../api/types';
import { HISTORY_STOP_LABELS, SOURCE_HEALTH_STATE_LABELS, formatDateTime, sourceLabel } from '../../lib/labels';
import { SiteProbeResult, SourceHealthCell } from '../SourceHealth';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { TableScroll } from '../ui/TableScroll';
import { HistoryDepthPicker } from './HistoryDepthPicker';
import styles from '../../pages/AdminPage.module.css';

export interface ISourcesTableProps {
  kind: ISourceRow['kind'];
  sources: ISourceRow[];
  onNotice: (text: string | null) => void;
}

/** Включён — значит собирается и разбирается: оба допуска действуют, опрос не на паузе. */
export const isSourceEnabled = (s: ISourceRow): boolean =>
  s.collectBlockedReason === null && s.aiBlockedReason === null && (s.kind === 'manual' || s.status !== 'paused');

/** Где искать канал или сайт: ссылка рядом с именем, чтобы сверить, что это тот самый. */
const sourceHref = (s: ISourceRow): string | null =>
  s.kind === 'telegram' ? `https://t.me/${s.key}` : s.kind === 'website' ? `https://${s.key}` : null;

/**
 * Состояние коротко: одна отметка словами, причина — только если что-то не так, и последний
 * сбор. Раньше здесь было восемь строк служебных подробностей на каждый источник; они
 * остались под «подробнее» — для разбора сбоя, а не для ежедневного взгляда.
 */
const SourceStatus: FC<{ source: ISourceRow; enabled: boolean }> = ({ source, enabled }) => {
  const state = source.healthState?.state ?? 'never_run';
  const lastSaved = source.lastSaved ?? source.lastItemsNew ?? null;
  return (
    <div className={styles.statusBrief}>
      <span className={styles.statusLine}>
        {!enabled ? 'выключен' : (SOURCE_HEALTH_STATE_LABELS[state] ?? state)}
        {source.items !== undefined && <span className={styles.statusMeta}> · публикаций {source.items}</span>}
      </span>
      {enabled && state !== 'healthy' && source.healthState?.reason && (
        <span className={styles.statusReason}>{source.healthState.reason}</span>
      )}
      {source.lastAttemptAt && (
        <span className={styles.statusMeta}>
          сбор {formatDateTime(source.lastAttemptAt)}
          {lastSaved !== null ? `, новых ${lastSaved}` : ''}
        </span>
      )}
      <details className={styles.statusMore}>
        <summary>подробнее</summary>
        <SourceHealthCell source={source} />
      </details>
    </div>
  );
};

const NAME_HEADER: Record<ISourceRow['kind'], string> = {
  telegram: 'Канал',
  website: 'Сайт',
  manual: 'Вход',
};

export const SourcesTable: FC<ISourcesTableProps> = ({ kind, sources, onNotice }) => {
  const queryClient = useQueryClient();
  const [probeResult, setProbeResult] = useState<{ id: number; report: ISiteProbeReport } | null>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['sources'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
    void queryClient.invalidateQueries({ queryKey: ['pipeline'] });
  };

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.post(`/api/admin/sources/${id}/enabled`, { enabled }),
    onSuccess: (_result, { enabled }) => {
      onNotice(
        enabled
          ? 'Источник включён: сбор начнётся в ближайший проход, новые публикации уйдут в разбор.'
          : 'Источник выключен: сбор и разбор остановлены, собранное остаётся.',
      );
      invalidate();
    },
    onError: (err: Error) => onNotice(err.message),
  });

  const setHistory = useMutation({
    mutationFn: ({ id, days }: { id: number; days: number | null }) =>
      api.put(`/api/admin/sources/${id}/history`, { days }),
    onSuccess: (_result, { days }) => {
      onNotice(
        days === null
          ? 'Срок сбора снят.'
          : `Срок сбора — ${days} дн. История догружается в фоне, в прежнем темпе запросов к источнику.`,
      );
      invalidate();
    },
    onError: (err: Error) => onNotice(err.message),
  });

  // Проба уже включённого сайта: живой запрос по действию оператора, без записи.
  const probe = useMutation({
    mutationFn: (id: number) => api.post<{ report: ISiteProbeReport }>(`/api/admin/sources/${id}/probe`),
    onSuccess: (result, id) => setProbeResult({ id, report: result.report }),
    onError: (err: Error) => onNotice(err.message),
  });

  const removeSource = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/sources/${id}`),
    onSuccess: () => {
      onNotice('Источник удалён.');
      invalidate();
    },
    onError: (err: Error) => onNotice(err.message),
  });

  if (sources.length === 0) return null;
  const withHistory = kind !== 'manual';
  const columns = withHistory ? 5 : 4;

  return (
    <TableScroll minWidth={withHistory ? 760 : 560}>
      <thead>
        <tr>
          <th>{NAME_HEADER[kind]}</th>
          <th>{kind === 'manual' ? 'Приём' : 'Сбор'}</th>
          {withHistory && <th>Срок сбора</th>}
          <th>Состояние</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {sources.map(s => {
          const name = sourceLabel({ sourceTitle: s.title, sourceKey: s.key, sourceKind: s.kind });
          const href = sourceHref(s);
          const enabled = isSourceEnabled(s);
          const stop = typeof s.lastCoverage?.stopReason === 'string' ? s.lastCoverage.stopReason : null;
          return (
            <Fragment key={s.id}>
              <tr>
                <td>
                  <span className={styles.sourceTitle}>{name}</span>
                  {href && (
                    <a className={styles.sourceKey} href={href} target="_blank" rel="noreferrer noopener">
                      {s.kind === 'telegram' ? `t.me/${s.key}` : s.key}
                    </a>
                  )}
                </td>
                <td>
                  <Switch
                    checked={enabled}
                    label={`${kind === 'manual' ? 'Приём' : 'Сбор'}: ${name}`}
                    disabled={toggle.isPending}
                    onChange={next => toggle.mutate({ id: s.id, enabled: next })}
                  />
                </td>
                {withHistory && (
                  <td>
                    <HistoryDepthPicker
                      kind={s.kind === 'telegram' ? 'telegram' : 'website'}
                      value={s.historyDays ?? null}
                      label={`Срок сбора: ${name}`}
                      disabled={setHistory.isPending}
                      onChange={days => setHistory.mutate({ id: s.id, days })}
                    />
                    {s.historyDays != null && stop && HISTORY_STOP_LABELS[stop] && (
                      <span className={styles.sourceKey}>{HISTORY_STOP_LABELS[stop]}</span>
                    )}
                  </td>
                )}
                <td>
                  <SourceStatus source={s} enabled={enabled} />
                </td>
                <td>
                  <div className={styles.rowActions}>
                    {s.kind === 'website' && enabled && (
                      <Button
                        size="sm"
                        disabled={probe.isPending}
                        hint="Одна страница, до трёх записей, ничего не сохраняет"
                        onClick={() => probe.mutate(s.id)}
                      >
                        Проба
                      </Button>
                    )}
                    {/* Удаляется только источник без документов. С документами — выключение:
                        удаление унесло бы упоминания и события. */}
                    {s.kind !== 'manual' && (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={removeSource.isPending}
                        hint="источник с собранными публикациями удалить нельзя — только выключить"
                        onClick={() => removeSource.mutate(s.id)}
                      >
                        Удалить
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
              {probeResult?.id === s.id && (
                <tr>
                  <td colSpan={columns}>
                    <SiteProbeResult report={probeResult.report} onClose={() => setProbeResult(null)} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </TableScroll>
  );
};
