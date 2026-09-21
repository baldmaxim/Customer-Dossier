import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { api } from '../../api/client';
import type { IEnqueueResult, IRunDetail } from '../../api/types';
import { PublishPreviewPanel } from '../../components/PublishPreviewPanel';
import { describeLoadError } from '../../lib/loadError';
import {
  CANDIDATE_SET_STATUS_LABELS,
  CANDIDATE_VERDICT_LABELS,
  CHUNK_OUTCOME_LABELS,
  ENQUEUE_OUTCOME_LABELS,
  RUN_STATUS_LABELS,
  formatDateTime,
} from '../../lib/labels';
import styles from '../Dossier.module.css';

/** Карточка запуска (этап 15B): редакция и публикация, цепочка повторов, чанки и ответы, кандидаты с цитатами. */
export const RunPage: FC = () => {
  const { id } = useParams();
  const runId = Number(id);
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.get<IRunDetail>(`/api/reprocess/runs/${runId}`),
    enabled: Number.isSafeInteger(runId) && runId > 0,
  });

  const action = useMutation({
    mutationFn: (path: string) => api.post<IEnqueueResult>(path, {}),
    onSuccess: r => {
      // Подписи исходов — общие с постановкой из админки и истории редакций (lib/labels.ts).
      const label = ENQUEUE_OUTCOME_LABELS[r.outcome] ?? r.outcome;
      const text =
        r.outcome === 'cancelled' ? (r.note ?? `${label}.`) : r.runId === undefined ? `${label}.` : `${label}: #${r.runId}.`;
      const worker = r.pipelineEnabled === false && (r.outcome === 'queued' || r.outcome === 'already_retried') ? ' Исполнитель выключен: выполните `npm run pipeline:once`.' : '';
      setNotice(text + worker);
      void queryClient.invalidateQueries({ queryKey: ['run'] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (err: Error) => setNotice(describeLoadError(err)),
  });

  if (run.isLoading) return <p className={styles.meta}>Загрузка запуска…</p>;
  if (run.isError || !run.data) {
    return (
      <div className={styles.page}>
        <p className={styles.error} role="alert">
          {run.isError ? describeLoadError(run.error) : 'Некорректный номер запуска.'}
        </p>
        <Link to="/admin/process">К списку запусков</Link>
      </div>
    );
  }
  const r = run.data;
  const pendingLatest = r.latestRevision !== null && r.latestRevision.no > r.revision.no;
  const retryable = ['failed', 'partial', 'cancelled'].includes(r.status);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.meta}>
          <Link to="/admin/process">Запуски</Link> / #{r.id}
        </p>
        <h1 className={styles.title}>
          Запуск #{r.id}: {RUN_STATUS_LABELS[r.status] ?? r.status}
        </h1>
        {r.error && <p className={styles.warn}>{r.error}</p>}
        <p className={styles.meta}>
          {r.source.key} · публикация #{r.sourceItemId} · редакция №{r.revision.no} ({r.revision.bodyChars} символов) · {r.model ?? 'модель неизвестна'} ·{' '}
          {r.schemaVersion ?? 'схема неизвестна'} · отпечаток {r.fingerprint.slice(0, 12)}
          {r.identity.historical ? ' · конфигурация до этапа 11' : ''}
          {!r.identity.candidateBuildCurrent ? ' · проверка кандидатов прежней версии' : ''}
        </p>
        <p className={styles.meta}>
          Поставлен {formatDateTime(r.createdAt)} ({r.requestedBy}) · начат {formatDateTime(r.startedAt)} · завершён {formatDateTime(r.finishedAt)} · ответов {r.usage.responses} · токены{' '}
          {r.usage.tokensIn === null ? 'неизвестны' : `${r.usage.tokensIn}/${r.usage.tokensOut}`} · время {r.usage.latencyMs === null ? 'неизвестно' : `${r.usage.latencyMs} мс`}
        </p>
        {!r.policy.allowed && <p className={styles.error}>ИИ-допуск источника не действует: {r.policy.reason}</p>}
        {r.inFlight && (
          <p className={styles.warn}>
            Выполняется: запрос к модели мог уже уйти (аренда {r.lease.owner} до {formatDateTime(r.lease.expiresAt)}). Отмена остановит следующие шаги, но не отзовёт уже отправленный текст.
          </p>
        )}
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Редакция и публикация</h2>
        <p className={styles.meta}>
          Опубликовано сейчас:{' '}
          {r.publication.activeSetId === null
            ? 'ничего'
            : `набор #${r.publication.activeSetId} (запуск #${r.publication.activeRunId}, редакция №${r.publication.activeRevisionNo}), версия ${r.publication.version}`}
          .
        </p>
        {pendingLatest && (
          <p className={styles.warn}>
            Есть более новая редакция №{r.latestRevision!.no}: этот запуск разбирал №{r.revision.no}. Основание текущих фактов и новая редакция — разные тексты.{' '}
            <button type="button" className={styles.linkButton} disabled={action.isPending} onClick={() => action.mutate(`/api/reprocess/revisions/${r.latestRevision!.id}/runs`)}>
              Поставить запуск по №{r.latestRevision!.no}
            </button>
          </p>
        )}
        <p className={styles.meta}>
          Цепочка повторов: {r.lineage.previous.length === 0 ? 'первый запуск' : r.lineage.previous.map(p => `#${p.id} (${RUN_STATUS_LABELS[p.status] ?? p.status})`).join(' ← ')}
          {r.lineage.retries.length > 0 && (
            <>
              {' '}
              · повторы:{' '}
              {r.lineage.retries.map(x => (
                <Link key={x.id} to={`/admin/process/${x.id}`}>
                  #{x.id} ({RUN_STATUS_LABELS[x.status] ?? x.status}){' '}
                </Link>
              ))}
            </>
          )}
        </p>
        <div className={styles.row}>
          {(r.status === 'queued' || r.status === 'running') && (
            <button type="button" className={styles.button} disabled={action.isPending} onClick={() => action.mutate(`/api/reprocess/runs/${r.id}/cancel`)}>
              Отменить запуск
            </button>
          )}
          {retryable && (
            <button type="button" className={styles.button} disabled={action.isPending || !r.policy.allowed} onClick={() => action.mutate(`/api/reprocess/runs/${r.id}/retry`)}>
              Повторить новым запуском
            </button>
          )}
        </div>
        {notice && (
          <p className={styles.meta} role="status">
            {notice}
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Чанки: {r.coverage.chunksOk} из {r.coverage.chunks} приняты, покрыто {r.coverage.coveredChars ?? '—'} из {r.coverage.totalChars ?? '—'} символов
        </h2>
        {r.chunks.length === 0 && <p className={styles.meta}>Чанков нет: запуск не начинался или текст не поместился в лимит чанков.</p>}
        <ul className={styles.list}>
          {r.chunks.map(c => (
            <li key={c.index} className={styles.listItem}>
              <strong>
                Чанк {c.index} [{c.rangeStart}–{c.rangeEnd}): {c.status === 'ok' ? 'принят' : c.status === 'failed' ? 'не разобран' : 'ожидает'}
              </strong>
              <span className={styles.meta}> · попыток {c.attempts}</span>
              {c.lastError && <p className={styles.warn}>{c.lastError}</p>}
              {c.responses.map(x => (
                <p key={x.attemptNo} className={styles.meta}>
                  попытка {x.attemptNo}: {CHUNK_OUTCOME_LABELS[x.outcome] ?? x.outcome}
                  {x.error ? ` — ${x.error}` : ''} · {x.latencyMs === null ? 'время неизвестно' : `${x.latencyMs} мс`} · {formatDateTime(x.createdAt)}
                </p>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Кандидаты{r.candidateSet ? ` набора #${r.candidateSet.id} (${CANDIDATE_SET_STATUS_LABELS[r.candidateSet.status] ?? r.candidateSet.status})` : ''}
        </h2>
        {!r.candidateSet && <p className={styles.meta}>Набора нет: он собирается только при полном разборе всех чанков и действующем допуске.</p>}
        <ul className={styles.list}>
          {r.candidates.map(c => (
            <li key={c.id} className={styles.listItem}>
              <strong>
                {c.predicate}
                {c.role ? ` · ${c.role}` : ''}
              </strong>
              <span className={c.verdict === 'publishable' ? styles.meta : styles.warn}> · {CANDIDATE_VERDICT_LABELS[c.verdict]}</span>
              {c.rejectedReason && <span className={styles.meta}> · причина: {c.rejectedReason}</span>}
              {c.parties.length > 0 && <p className={styles.meta}>{c.parties.join(', ')}</p>}
              {c.evidence.map(e => (
                <blockquote key={`${e.spanStart}-${e.spanEnd}-${e.stance}`} className={styles.quote}>
                  {e.quote}
                  <span className={styles.quoteMeta}>
                    {' '}
                    — редакция №{r.revision.no}, символы {e.spanStart}–{e.spanEnd}
                    {e.stance === 'contradicts' ? ', опровергает' : ''}
                  </span>
                </blockquote>
              ))}
            </li>
          ))}
        </ul>
        {r.ambiguities.length > 0 && (
          <p className={styles.meta}>
            Неоднозначные упоминания этой редакции: {r.ambiguities.map(a => `«${a.surface}» (${a.status})`).join(', ')} — разбор в <Link to="/admin/review">очереди проверки</Link>. Решение по
            упоминанию не публикует набор и не сливает компании.
          </p>
        )}
        {r.candidateSet && (
          <>
            <button type="button" className={styles.button} onClick={() => setShowPreview(!showPreview)} aria-expanded={showPreview}>
              {showPreview ? 'Скрыть предпросмотр' : 'Предпросмотр публикации'}
            </button>
            {showPreview && <PublishPreviewPanel setId={r.candidateSet.id} />}
          </>
        )}
      </section>
    </div>
  );
};
