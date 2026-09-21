import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import type { IPublishPreview, IPublishPreviewItem, IPublishResult } from '../api/types';
import { describeLoadError } from '../lib/loadError';
import styles from '../pages/Dossier.module.css';

const Items: FC<{ title: string; items: IPublishPreviewItem[] }> = ({ title, items }) =>
  items.length === 0 ? null : (
    <details>
      <summary>
        {title}: {items.length}
      </summary>
      <ul className={styles.list}>
        {items.map(i => (
          <li key={i.signature} className={styles.listItem}>
            <span className={styles.meta}>{i.signature}</span>
            {i.quotes.map(q => (
              <blockquote key={q} className={styles.quote}>
                {q}
              </blockquote>
            ))}
          </li>
        ))}
      </ul>
    </details>
  );

/**
 * Предпросмотр и публикация одного набора (этап 15B). Числа — кандидаты, найденные в тексте, а не подтверждённые факты.
 * Публикация идёт с токеном предпросмотра: если после него изменились допуск, редакции или решения — сервер откажет,
 * и нужно открыть предпросмотр заново.
 */
export const PublishPreviewPanel: FC<{ setId: number }> = ({ setId }) => {
  const queryClient = useQueryClient();
  const [allowStale, setAllowStale] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  const preview = useQuery({
    queryKey: ['publish-preview', setId],
    queryFn: () => api.get<IPublishPreview>(`/api/reprocess/sets/${setId}/preview`),
    // Оценка не подменяется фоновым обновлением: публикуется то, что оператор видел.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const publish = useMutation({
    mutationFn: (p: IPublishPreview) =>
      api.post<IPublishResult>(`/api/reprocess/sets/${setId}/publish`, {
        expectedVersion: p.expectedVersion,
        expectedPreviewToken: p.previewToken,
        allowStale,
      }),
    onSuccess: r => {
      void queryClient.invalidateQueries({ queryKey: ['run'] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      if (r.outcome === 'published' || r.outcome === 'already_published') {
        setResult({ tone: 'ok', text: r.outcome === 'published' ? `Опубликовано: утверждений ${r.assertions}, новых оснований ${r.evidenceAdded}, снято ${r.evidenceSuperseded}.` : 'Этот набор уже опубликован.' });
      } else {
        setResult({ tone: 'warn', text: `Не опубликовано: ${r.reason ?? r.outcome}. ${r.nextStep ?? ''}` });
      }
      void preview.refetch();
    },
    onError: (err: Error) => {
      const body = err instanceof ApiError ? (err.body as { nextStep?: string } | null) : null;
      setResult({ tone: 'error', text: `${describeLoadError(err)} ${body?.nextStep ?? ''}` });
      if (err instanceof ApiError && err.status === 409) void preview.refetch();
    },
  });

  if (preview.isLoading) return <p className={styles.meta}>Загрузка предпросмотра…</p>;
  if (preview.isError || !preview.data) {
    return (
      <p className={styles.error} role="alert">
        Предпросмотр недоступен: {describeLoadError(preview.error)}
      </p>
    );
  }
  const p = preview.data;
  const blocked = !p.run.complete || !p.policy.allowed;

  return (
    <div className={styles.form}>
      <p className={styles.hint}>
        Ниже — кандидаты из текста, а не проверенные факты. Публикация не ставит «проверено аналитиком» и не трогает решения
        аналитика и доказательства других публикаций.
      </p>
      {!p.run.complete && (
        <p className={styles.error}>
          Запуск не завершён полностью ({p.run.status}, покрыто {p.run.coveredChars ?? '?'} из {p.run.totalChars ?? '?'}) — набор не публикуется. Следующий шаг: повторить запуск.
        </p>
      )}
      {!p.policy.allowed && <p className={styles.error}>Нет ИИ-допуска источника: {p.policy.reason}. Допуск оформляет оператор с основанием.</p>}
      {p.stale.stale && <p className={styles.warn}>Устаревший разбор: {p.stale.reason}</p>}
      <p className={styles.meta}>
        Публикация #{p.sourceItemId}, версия {p.expectedVersion}; сейчас активен набор {p.activeSetId === null ? 'нет' : `#${p.activeSetId}`}.
        Текст {p.relevant ? 'признан относящимся к стройке' : 'признан нерелевантным'}.
      </p>
      <Items title="Добавятся" items={p.added} />
      <Items title="Снимутся (основания прежнего набора)" items={p.removed} />
      <Items title="Останутся" items={p.kept} />
      <Items title="Не публикуются (не найдены в тексте или на проверке)" items={p.ungrounded} />
      {p.changed.length > 0 && (
        <details>
          <summary>Изменятся детали: {p.changed.length}</summary>
          <ul className={styles.list}>
            {p.changed.map(c => (
              <li key={c.before + c.after} className={styles.listItem}>
                <span className={styles.meta}>было: {c.before}</span>
                <br />
                <span className={styles.meta}>станет: {c.after}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {p.reviewImpact.length > 0 && (
        <p className={styles.warn}>
          Решения аналитика останутся, но у {p.reviewImpact.length} утверждений снимется это основание — они попадут в «нужен пересмотр»:{' '}
          {p.reviewImpact.map(r => `#${r.assertionId}`).join(', ')}.
        </p>
      )}
      {p.contradictions.length > 0 && (
        <p className={styles.warn}>Есть опровержения из других источников: {p.contradictions.map(c => `#${c.assertionId}`).join(', ')}.</p>
      )}
      {p.stale.stale && (
        <label className={styles.row}>
          <input type="checkbox" checked={allowStale} onChange={e => setAllowStale(e.target.checked)} />
          <span>Опубликовать устаревший разбор отдельным решением</span>
        </label>
      )}
      {result && (
        <p className={result.tone === 'ok' ? styles.meta : result.tone === 'warn' ? styles.warn : styles.error} role={result.tone === 'ok' ? undefined : 'alert'}>
          {result.text}
        </p>
      )}
      <div className={styles.row}>
        <button type="button" className={styles.buttonPrimary} disabled={blocked || publish.isPending} onClick={() => publish.mutate(p)}>
          Опубликовать этот набор
        </button>
        <button type="button" className={styles.button} onClick={() => void preview.refetch()}>
          Обновить предпросмотр
        </button>
        <Link to="/admin/review">Очередь проверки</Link>
      </div>
    </div>
  );
};
