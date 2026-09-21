import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { IPublishPreview, IPublishPreviewItem } from '../api/types';
import { RUN_STATUS_LABELS } from '../lib/labels';
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
 * Что набор кандидатов даёт карточкам — только чтение.
 *
 * Оператор ничего не публикует: разбор уходит в карточки сам после полного прохода.
 * Здесь видно, что именно туда попало, что снялось прежним разбором и что не попало
 * вовсе. Числа — кандидаты, найденные в тексте, а не подтверждённые факты.
 */
export const CandidateSetPanel: FC<{ setId: number }> = ({ setId }) => {
  const preview = useQuery({
    queryKey: ['candidate-set', setId],
    queryFn: () => api.get<IPublishPreview>(`/api/reprocess/sets/${setId}/preview`),
  });

  if (preview.isLoading) return <p className={styles.meta}>Загрузка набора…</p>;
  if (preview.isError || !preview.data) {
    return (
      <p className={styles.error} role="alert">
        Набор недоступен: {describeLoadError(preview.error)}
      </p>
    );
  }
  const p = preview.data;

  return (
    <div className={styles.form}>
      <p className={styles.hint}>
        Ниже — кандидаты из текста, а не проверенные факты. Попадание в карточки не ставит «проверено
        аналитиком» и не трогает решения аналитика и доказательства других публикаций.
      </p>
      {!p.run.complete && (
        <p className={styles.error}>
          Запуск не завершён полностью ({RUN_STATUS_LABELS[p.run.status] ?? p.run.status}, покрыто{' '}
          {p.run.coveredChars ?? '?'} из {p.run.totalChars ?? '?'}) — такой набор в карточки не идёт ни при
          каком флаге. Портал повторит разбор сам.
        </p>
      )}
      {!p.policy.allowed && (
        <p className={styles.error}>Нет ИИ-допуска источника: {p.policy.reason}. Допуск оформляет оператор с основанием.</p>
      )}
      {p.stale.stale && <p className={styles.warn}>Устаревший разбор: {p.stale.reason}</p>}
      <p className={styles.meta}>
        Публикация #{p.sourceItemId}, версия {p.expectedVersion}; сейчас в карточках набор{' '}
        {p.activeSetId === null ? 'нет' : `#${p.activeSetId}`}. Текст{' '}
        {p.relevant ? 'признан относящимся к стройке' : 'признан нерелевантным'}.
      </p>
      <Items title="Взято в карточки" items={p.added} />
      <Items title="Снято (основания прежнего набора)" items={p.removed} />
      <Items title="Осталось прежним" items={p.kept} />
      <Items title="Не взято (нет в тексте или на проверке)" items={p.ungrounded} />
      {p.changed.length > 0 && (
        <details>
          <summary>Изменились детали: {p.changed.length}</summary>
          <ul className={styles.list}>
            {p.changed.map(c => (
              <li key={c.before + c.after} className={styles.listItem}>
                <span className={styles.meta}>было: {c.before}</span>
                <br />
                <span className={styles.meta}>стало: {c.after}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {p.reviewImpact.length > 0 && (
        <p className={styles.warn}>
          Решения аналитика остались, но у {p.reviewImpact.length} утверждений снялось это основание — они
          попали в «нужен пересмотр»: {p.reviewImpact.map(r => `#${r.assertionId}`).join(', ')}.
        </p>
      )}
      {p.contradictions.length > 0 && (
        <p className={styles.warn}>Есть опровержения из других источников: {p.contradictions.map(c => `#${c.assertionId}`).join(', ')}.</p>
      )}
      <div className={styles.row}>
        <Link to="/admin/review">Очередь проверки</Link>
      </div>
    </div>
  );
};
