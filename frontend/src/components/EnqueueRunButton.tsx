import { FC, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import type { IEnqueueResult } from '../api/types';
import { ENQUEUE_OUTCOME_LABELS } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import styles from './EnqueueRunButton.module.css';

interface IEnqueueRunButtonProps {
  revisionId: number;
  /** Класс кнопки задаёт вмещающий экран: кнопки админки и истории редакций выглядят по-разному. */
  className?: string;
  label?: string;
}

/** Исходы, после которых запуск уже стоит: повторное нажатие ничего не добавит. */
const SETTLED = new Set(['queued', 'already_live', 'already_retried']);

/**
 * Постановка запуска по одной редакции (`POST /api/reprocess/revisions/:id/runs`).
 *
 * Постановка не вызывает модель: запуск выполнит фоновый исполнитель (PIPELINE_ENABLED) или
 * `npm run pipeline:once`. Поэтому «поставлено» здесь не означает «разобрано», а при выключенном
 * исполнителе это сказано прямо. Второй запуск той же конфигурации не создаётся — сервер вернёт
 * уже живой (`already_live`).
 */
export const EnqueueRunButton: FC<IEnqueueRunButtonProps> = ({ revisionId, className, label = 'Поставить на разбор' }) => {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<IEnqueueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enqueue = useMutation({
    mutationFn: () => api.post<IEnqueueResult>(`/api/reprocess/revisions/${revisionId}/runs`, {}),
    onSuccess: r => {
      setError(null);
      setResult(r);
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['run'] });
    },
    onError: (err: Error) => {
      setResult(null);
      // Отказ политики и «не найдено» приходят с причиной словами: показываем её, а не номер статуса.
      setError(err instanceof ApiError && err.code !== null && err.code in ENQUEUE_OUTCOME_LABELS ? err.message : describeLoadError(err));
    },
  });

  const settled = result !== null && SETTLED.has(result.outcome);
  const waiting = settled && result?.pipelineEnabled === false;
  const refused = error !== null && enqueue.error instanceof ApiError && enqueue.error.code === 'refused_policy';

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={className}
        disabled={enqueue.isPending || settled}
        onClick={() => enqueue.mutate()}
      >
        {enqueue.isPending ? 'Ставлю…' : label}
      </button>

      {result && (
        <p className={styles.note} role="status">
          {ENQUEUE_OUTCOME_LABELS[result.outcome] ?? result.outcome}
          {result.runId !== undefined && (
            <>
              {': '}
              <Link to={`/admin/process/${result.runId}`}>запуск #{result.runId}</Link>
            </>
          )}
          {'. '}
          {waiting
            ? 'Задание ожидает выполнения: фоновый исполнитель выключен, выполните '
            : 'Разбор идёт отдельно от постановки: результат смотрите в карточке запуска.'}
          {waiting && <code>npm run pipeline:once</code>}
          {waiting && '.'}
        </p>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
          {refused && ' Допуск на ИИ-обработку ставит оператор в админке, раздел «Источники»; постановка его не выдаёт.'}
        </p>
      )}
    </div>
  );
};
