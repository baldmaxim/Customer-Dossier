import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { api } from '../../api/client';
import type { IRunDetail } from '../../api/types';
import { CandidateSetPanel } from '../../components/CandidateSetPanel';
import { describeLoadError } from '../../lib/loadError';
import {
  AMBIGUITY_STATUS_LABELS,
  ASSERTION_ROLE_LABELS,
  CANDIDATE_SET_STATUS_LABELS,
  CANDIDATE_VERDICT_LABELS,
  CHUNK_OUTCOME_LABELS,
  CHUNK_STATUS_LABELS,
  PREDICATE_HINTS,
  PREDICATE_LABELS,
  RUN_STATUS_LABELS,
  formatDateTime,
} from '../../lib/labels';
import { Term } from '../../components/ui/Hint';
import styles from '../Dossier.module.css';

/**
 * Карточка запуска — только чтение: редакция и что в карточках, цепочка повторов,
 * чанки и ответы, кандидаты с цитатами. Обработка идёт сама, запускать и отменять
 * её отсюда нечем; восстановление после сбоя — командами CLI.
 */
export const RunPage: FC = () => {
  const { id } = useParams();
  const runId = Number(id);

  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.get<IRunDetail>(`/api/reprocess/runs/${runId}`),
    enabled: Number.isSafeInteger(runId) && runId > 0,
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
            Выполняется: запрос к модели ушёл (аренда {r.lease.owner} до {formatDateTime(r.lease.expiresAt)}).
          </p>
        )}
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Редакция и карточки</h2>
        <p className={styles.meta}>
          Сейчас в карточках:{' '}
          {r.publication.activeSetId === null
            ? 'ничего'
            : `набор #${r.publication.activeSetId} (запуск #${r.publication.activeRunId}, редакция №${r.publication.activeRevisionNo}), версия ${r.publication.version}`}
          .
        </p>
        {pendingLatest && (
          <p className={styles.warn}>
            Есть более новая редакция №{r.latestRevision!.no}: этот запуск разбирал №{r.revision.no}. Основание
            текущих сведений и новая редакция — разные тексты; портал разберёт новую сам.
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
                Чанк {c.index} [{c.rangeStart}–{c.rangeEnd}): {CHUNK_STATUS_LABELS[c.status] ?? c.status}
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
                <Term value={c.predicate} labels={PREDICATE_LABELS} hints={PREDICATE_HINTS} />
                {c.role ? ` · ${ASSERTION_ROLE_LABELS[c.role] ?? c.role}` : ''}
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
            Неоднозначные упоминания этой редакции: {r.ambiguities.map(a => `«${a.surface}» (${AMBIGUITY_STATUS_LABELS[a.status] ?? a.status})`).join(', ')} — разбор в <Link to="/admin/review">очереди проверки</Link>. Решение по
            упоминанию не публикует набор и не сливает компании.
          </p>
        )}
        {r.candidateSet && <CandidateSetPanel setId={r.candidateSet.id} />}
      </section>
    </div>
  );
};
