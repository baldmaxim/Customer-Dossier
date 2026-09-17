import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import type { AmbiguityDecisionKind, IAmbiguityDetail } from '../api/types';
import { AMBIGUITY_DECISION_LABELS, AMBIGUITY_STATUS_LABELS, ENTITY_TYPE_LABELS, formatDateTime } from '../lib/labels';
import styles from '../pages/Dossier.module.css';

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ambiguity-${Date.now()}-${Math.random()}`;

/**
 * Разбор одного неоднозначного упоминания (этап 15A): цитата, кандидаты с реквизитами, причина неопределённости,
 * история решений. Решение относится только к этому упоминанию; глобальное слияние — в очереди слияний с предпросмотром.
 */
export const AmbiguityDetail: FC<{ ambiguityId: number }> = ({ ambiguityId }) => {
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<{ decision: AmbiguityDecisionKind; entityId: number | null } | null>(null);
  const [reason, setReason] = useState('');
  // Один ключ на открытую форму: повторное нажатие не создаёт второе решение.
  const [key, setKey] = useState(newKey);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['ambiguity', ambiguityId],
    queryFn: () => api.get<IAmbiguityDetail>(`/api/entities/ambiguities/${ambiguityId}`),
    refetchOnWindowFocus: false,
  });

  const decide = useMutation({
    mutationFn: (input: { version: number }) =>
      api.post<{ decisionId: number; replayed: boolean; version: number }>(`/api/entities/ambiguities/${ambiguityId}/decisions`, {
        decision: choice?.decision,
        entityId: choice?.entityId ?? null,
        reason,
        expectedVersion: input.version,
        idempotencyKey: key,
      }),
    onSuccess: result => {
      setNotice(result.replayed ? 'Это решение уже было записано.' : `Решение #${result.decisionId} записано.`);
      setChoice(null);
      setReason('');
      setKey(newKey());
      void queryClient.invalidateQueries({ queryKey: ['ambiguity', ambiguityId] });
      void queryClient.invalidateQueries({ queryKey: ['ambiguities'] });
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        setError('Неоднозначность изменилась (новые кандидаты или другое решение). Решение не записано — данные обновлены.');
        void detail.refetch();
      } else if (err instanceof ApiError && err.code === 'choice_blocked') {
        setError(`Выбор отклонён сервером: ${err.message}`);
      } else {
        setError(err.message);
      }
    },
  });

  if (detail.isLoading) return <p className={styles.meta}>Загрузка упоминания…</p>;
  if (detail.isError || !detail.data) {
    return (
      <p className={styles.error} role="alert">
        Упоминание недоступно: {(detail.error as Error | null)?.message ?? 'нет данных'}
      </p>
    );
  }
  const d = detail.data;
  const cardPath = (id: number): string => (d.entityKind === 'company' ? `/company/${id}` : `/projects/${id}`);

  return (
    <div className={styles.form}>
      <p className={styles.statusLine}>
        «{d.surface}» · {AMBIGUITY_STATUS_LABELS[d.status] ?? d.status} · версия {d.version} · встречено {d.occurrences}
      </p>
      <p className={styles.warn}>{d.scopeNote}</p>
      <p className={styles.meta}>Почему неоднозначно: {d.whyAmbiguous}</p>
      {d.revision ? (
        <>
          <blockquote className={styles.quote}>{d.revision.excerpt ?? 'упоминание в тексте редакции дословно не найдено'}</blockquote>
          <p className={styles.quoteMeta}>
            редакция #{d.revision.id}
            {d.revision.publishedAt ? ` · опубликовано ${formatDateTime(d.revision.publishedAt)}` : ''}
          </p>
        </>
      ) : (
        <p className={styles.meta}>Редакция не сохранена: решение не будет применено резолвером.</p>
      )}

      <ul className={styles.candidates}>
        {d.candidates.map(c => {
          const blocked = c.choice.conflicts.length > 0;
          const active = choice?.decision === 'resolved_to' && choice.entityId === c.id;
          return (
            <li key={c.id} className={active ? styles.candidateActive : styles.candidate}>
              <div className={styles.row}>
                <Link to={cardPath(c.id)}>
                  {c.name} #{c.id}
                </Link>
                <span className={styles.meta}>
                  {d.entityKind === 'company' ? (ENTITY_TYPE_LABELS[c.entityType ?? 'unknown'] ?? c.entityType) : c.entityType}
                  {c.legalForm ? ` · ${c.legalForm}` : ''} · {c.city ?? 'город неизвестен'}
                </span>
              </div>
              <span className={styles.meta}>
                {c.identifiers.length > 0 ? c.identifiers.map(i => `${i.type} ${i.value}`).join(', ') : 'реквизитов нет'}
                {c.mergedIntoId !== null ? ` · слита в #${c.mergedIntoId}` : ''}
              </span>
              {c.choice.conflicts.map(x => (
                <span key={x.code + x.message} className={styles.error}>
                  Нельзя: {x.message}
                </span>
              ))}
              {d.status === 'open' && (
                <button
                  type="button"
                  className={styles.button}
                  disabled={blocked}
                  aria-pressed={active}
                  onClick={() => setChoice({ decision: 'resolved_to', entityId: c.id })}
                >
                  В этом тексте — эта сущность
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {d.candidates[0]?.choice.notes.map(n => (
        <p key={n} className={styles.hint}>
          {n}
        </p>
      ))}

      {d.status === 'open' && (
        <>
          <div className={styles.row}>
            <button type="button" className={styles.button} aria-pressed={choice?.decision === 'kept_unknown'} onClick={() => setChoice({ decision: 'kept_unknown', entityId: null })}>
              Оставить неустановленным
            </button>
            <button type="button" className={styles.button} aria-pressed={choice?.decision === 'dismissed'} onClick={() => setChoice({ decision: 'dismissed', entityId: null })}>
              Не упоминание
            </button>
          </div>
          {choice && (
            <label className={styles.field}>
              <span>
                Причина решения «{AMBIGUITY_DECISION_LABELS[choice.decision]}
                {choice.entityId !== null ? ` #${choice.entityId}` : ''}» (обязательно)
              </span>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={2000} />
            </label>
          )}
          <p className={styles.hint}>
            Выбор юрлица не подтверждает участие, договор или долг: утверждения проверяются отдельно. Слить одноимённые сущности —
            только в очереди слияний после предпросмотра.
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {notice && <p className={styles.meta}>{notice}</p>}
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={!choice || reason.trim().length < 3 || decide.isPending}
            onClick={() => {
              setError(null);
              setNotice(null);
              decide.mutate({ version: d.version });
            }}
          >
            Записать решение
          </button>
        </>
      )}
      {d.status !== 'open' && notice && <p className={styles.meta}>{notice}</p>}

      {d.decisions.length > 0 && (
        <>
          <p className={styles.statusLine}>История решений</p>
          <ul className={styles.list}>
            {d.decisions.map(x => (
              <li key={x.id} className={styles.listItem}>
                #{x.id} · {AMBIGUITY_DECISION_LABELS[x.decision] ?? x.decision}
                {x.entityId !== null ? ` #${x.entityId}` : ''} · {x.actor} · {formatDateTime(x.decidedAt)} · к версии {x.ambiguityVersion}
                <br />
                <span className={styles.meta}>{x.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};
