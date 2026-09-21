// Таблица источников: допуск, здоровье, пауза, проба, удаление.
// Вырезано из AdminPage (453 строки) при разделении админки на ступени конвейера.
// Разметка перенесена дословно; кнопки переведены на примитив Button.

import { FC, Fragment, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ISiteProbeReport, ISourceRow } from '../../api/types';
import { SiteProbeResult, SourceHealthCell } from '../SourceHealth';
import { SourcePolicyEditor } from '../SourcePolicyEditor';
import { Button } from '../ui/Button';
import { PERMISSION_LABELS, SOURCE_KIND_LABELS } from '../../lib/labels';
import styles from '../../pages/AdminPage.module.css';

export interface ISourcesTableProps {
  sources: ISourceRow[];
  onNotice: (text: string | null) => void;
}

export const SourcesTable: FC<ISourcesTableProps> = ({ sources, onNotice }) => {
  const queryClient = useQueryClient();
  const [editingPolicy, setEditingPolicy] = useState<number | null>(null);
  const [probeResult, setProbeResult] = useState<{ id: number; report: ISiteProbeReport } | null>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['sources'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: ISourceRow['status'] }) =>
      api.patch(`/api/admin/sources/${id}`, { status }),
    onSuccess: invalidate,
  });

  // Проба уже допущенного сайта: живой запрос по действию оператора, без записи и без включения опроса.
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

  return (
      <div className="scroll-x">
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Источник</th>
              <th>Тип</th>
              <th>Статус</th>
              <th>Допуск</th>
              <th>Здоровье и последний запуск</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sources.map(s => (
              <Fragment key={s.id}>
              <tr>
                <td>
                  <span className={styles.sourceTitle}>{s.title}</span>
                  <span className={styles.sourceKey}>{s.key}</span>
                </td>
                <td>{SOURCE_KIND_LABELS[s.kind] ?? s.kind}</td>
                <td>
                  <span className={`${styles.status} ${styles[`status_${s.status}`] ?? ''}`}>
                    {s.status === 'active' ? 'активен' : s.status === 'paused' ? 'пауза' : 'сломан'}
                  </span>
                </td>
                <td className={styles.policyCell}>
                  {/* Причина блокировки — словами, как её считает сервер. */}
                  <span className={s.collectBlockedReason ? styles.policyBlocked : styles.policyOk}>
                    сбор: {PERMISSION_LABELS[s.accessStatus]}
                  </span>
                  <span className={s.aiBlockedReason ? styles.policyBlocked : styles.policyOk}>
                    ИИ: {PERMISSION_LABELS[s.aiProcessingStatus]}
                  </span>
                  {(s.collectBlockedReason ?? s.aiBlockedReason) && (
                    <span className={styles.policyReason}>{s.collectBlockedReason ?? s.aiBlockedReason}</span>
                  )}
                </td>
                <td>
                  <SourceHealthCell source={s} />
                </td>
                <td>
                  <div className={styles.rowActions}>
                    <Button
                      size="sm"
                      hint="решение оператора: кому и на каком основании разрешён сбор и ИИ-обработка"
                      onClick={() => setEditingPolicy(editingPolicy === s.id ? null : s.id)}
                    >
                      Допуск
                    </Button>
                    {s.kind === 'website' && !s.collectBlockedReason && (
                      <Button
                        size="sm"
                        disabled={probe.isPending}
                        hint="Одна страница, до трёх записей, ничего не сохраняет"
                        onClick={() => probe.mutate(s.id)}
                      >
                        Проба
                      </Button>
                    )}
                    {s.kind !== 'manual' && (
                      <>
                        <Button
                          size="sm"
                          disabled={setStatus.isPending}
                          hint="только расписание опроса; допуск этим не меняется"
                          onClick={() =>
                            setStatus.mutate({
                              id: s.id,
                              status: s.status === 'active' ? 'paused' : 'active',
                            })
                          }
                        >
                          {s.status === 'active' ? 'Пауза' : 'Включить'}
                        </Button>
                        {/* Удаляется только источник без документов. С документами —
                            пауза: удаление унесло бы упоминания и события. */}
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={removeSource.isPending}
                          hint="источник с документами удалить нельзя — только пауза"
                          onClick={() => removeSource.mutate(s.id)}
                        >
                          Удалить
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              {probeResult?.id === s.id && (
                <tr>
                  <td colSpan={6}>
                    <SiteProbeResult report={probeResult.report} onClose={() => setProbeResult(null)} />
                  </td>
                </tr>
              )}
              {editingPolicy === s.id && (
                <tr>
                  <td colSpan={6}>
                    <SourcePolicyEditor
                      source={s}
                      onCancel={() => setEditingPolicy(null)}
                      onSaved={() => {
                        setEditingPolicy(null);
                        onNotice(`Решение о допуске «${s.title}» сохранено и записано в журнал.`);
                        invalidate();
                      }}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
  );
};
