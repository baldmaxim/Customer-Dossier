import { FC, FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import type { AssertionStatus, IAssertion, IEvidenceRow, IReviewRow } from '../api/types';
import { describeAssertion } from '../lib/describeAssertion';
import {
  AMOUNT_PURPOSE_LABELS,
  ASSERTION_STATUS_LABELS,
  COMPLETENESS_LABELS,
  EVENT_OUTCOME_LABELS,
  EVENT_STAGE_LABELS,
  MODALITY_LABELS,
  POLARITY_LABELS,
  PRECISION_LABELS,
  REVIEW_SCOPE_LABELS,
  STANCE_LABELS,
  formatDate,
  formatDateTime,
} from '../lib/labels';
import styles from './AssertionReviewPanel.module.css';

interface IDetailResponse {
  assertion: IAssertion;
  evidence: IEvidenceRow[];
  reviews: IReviewRow[];
}

const DECISIONS: Array<{ value: AssertionStatus; label: string }> = [
  { value: 'reviewed_supported', label: 'Подтвердить' },
  { value: 'disputed', label: 'Спорно' },
  { value: 'rejected', label: 'Отклонить' },
  { value: 'candidate', label: 'Снять оценку' },
];

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/**
 * Утверждение: поддерживающие и опровергающие доказательства рядом, история
 * решений, новое решение с проверкой версии (вторая вкладка не затрёт первую).
 */
export const AssertionDetail: FC<{ assertionId: number }> = ({ assertionId }) => {
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<AssertionStatus>('reviewed_supported');
  const [scope, setScope] = useState<'reflects_source' | 'fact_confirmed'>('reflects_source');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  // Ключ идемпотентности живёт, пока форма не отправлена успешно: повтор
  // того же нажатия (двойной клик, повтор после сетевой ошибки) не создаёт дубль.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  // Отклонение, спор и возврат на проверку без причины сервер не примет (воспроизводимость решения).
  const reasonRequired = decision === 'rejected' || decision === 'disputed' || decision === 'candidate';

  const detailQuery = useQuery({
    queryKey: ['assertion', assertionId],
    queryFn: () => api.get<IDetailResponse>(`/api/assertions/${assertionId}`),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['assertion', assertionId] });
    void queryClient.invalidateQueries({ queryKey: ['assertions'] });
  };

  const conflictMessage = (err: Error): string =>
    err instanceof ApiError && err.status === 409
      ? 'Утверждение изменилось в другой вкладке или получило новое доказательство. Данные обновлены — проверьте и решите заново.'
      : err.message;

  const review = useMutation({
    mutationFn: (version: number) =>
      api.post(`/api/assertions/${assertionId}/reviews`, {
        decision,
        scope,
        reason: reason.trim() || null,
        expectedVersion: version,
        idempotencyKey,
      }),
    onSuccess: () => {
      setNotice('Решение записано.');
      setReason('');
      setIdempotencyKey(newKey());
      refresh();
    },
    onError: (err: Error) => {
      setNotice(conflictMessage(err));
      if (err instanceof ApiError && err.status === 409) {
        setIdempotencyKey(newKey());
        refresh();
      }
    },
  });

  const withdraw = useMutation({
    mutationFn: ({ evidenceId, why, version }: { evidenceId: number; why: string; version: number }) =>
      api.post(`/api/evidence/${evidenceId}/withdraw`, { reason: why, expectedVersion: version }),
    onSuccess: () => {
      setNotice('Доказательство отозвано. Решения сохранены; утверждение может потребовать пересмотра.');
      refresh();
    },
    onError: (err: Error) => {
      setNotice(conflictMessage(err));
      refresh();
    },
  });

  const grouped = useMemo(() => {
    const evidence = detailQuery.data?.evidence ?? [];
    return {
      supports: evidence.filter(e => e.stance === 'supports'),
      contradicts: evidence.filter(e => e.stance === 'contradicts'),
      mentions: evidence.filter(e => e.stance === 'mentions'),
    };
  }, [detailQuery.data]);

  if (detailQuery.isLoading) return <p className={styles.muted}>Загрузка…</p>;
  if (!detailQuery.data) return <p className={styles.muted}>Утверждение не найдено.</p>;

  const { assertion: a, reviews } = detailQuery.data;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    review.mutate(a.version);
  };

  const renderEvidence = (rows: IEvidenceRow[]) =>
    rows.map(e => (
      <li key={e.id} className={`${styles.evidence} ${e.status !== 'active' ? styles.evidenceInactive : ''}`}>
        <p className={styles.quote}>
          <span className={styles.context}>…{e.contextBefore}</span>
          <mark className={styles.mark}>{e.quote}</mark>
          <span className={styles.context}>{e.contextAfter}…</span>
        </p>
        <div className={styles.evidenceMeta}>
          <span>{e.sourceTitle}</span>
          <span>редакция {e.revisionNo}</span>
          <span>{COMPLETENESS_LABELS[e.completeness]}</span>
          {e.publishedAt && <span>{formatDate(e.publishedAt)}</span>}
          {e.legacyDocumentId !== null && <Link to={`/documents/${e.legacyDocumentId}`}>версии</Link>}
          {e.url && (
            <a href={e.url} target="_blank" rel="noreferrer noopener">
              оригинал
            </a>
          )}
          {e.status !== 'active' ? (
            <span className={styles.warn}>
              отозвано{e.statusReason ? `: ${e.statusReason}` : ''}
            </span>
          ) : (
            <button
              type="button"
              className={styles.linkButton}
              disabled={withdraw.isPending}
              onClick={() => {
                const why = window.prompt('Причина отзыва доказательства');
                if (why && why.trim().length >= 3) withdraw.mutate({ evidenceId: e.id, why: why.trim(), version: a.version });
              }}
            >
              отозвать
            </button>
          )}
        </div>
      </li>
    ));

  return (
    <div className={styles.detail}>
      <h3 className={styles.detailTitle}>{describeAssertion(a)}</h3>
      <p className={styles.muted}>
        {ASSERTION_STATUS_LABELS[a.status]} · {MODALITY_LABELS[a.modality] ?? a.modality}
        {a.polarity === 'negative' && ` · ${POLARITY_LABELS.negative}`}
        {a.attributedTo && ` · со слов: ${a.attributedTo}`}
        {a.validFrom && ` · с ${formatDate(a.validFrom)}`}
        {a.validTo && ` по ${formatDate(a.validTo)}`}
        {a.periodPrecision && a.periodPrecision !== 'day' && ` · ${PRECISION_LABELS[a.periodPrecision] ?? a.periodPrecision}`} · версия {a.version}
        {a.confidenceExtraction !== null && ` · уверенность модели ${Number(a.confidenceExtraction).toFixed(2)} (не вероятность истины)`}
      </p>
      {(a.eventStage || a.eventOutcome || a.valueNumeric) && (
        <p className={styles.muted}>
          {a.eventStage && `стадия: ${EVENT_STAGE_LABELS[a.eventStage] ?? a.eventStage}`}
          {a.eventOutcome && ` · результат по источнику: ${EVENT_OUTCOME_LABELS[a.eventOutcome] ?? a.eventOutcome}`}
          {a.valueNumeric &&
            ` · ${AMOUNT_PURPOSE_LABELS[a.valueType ?? 'amount'] ?? 'сумма'}: ${a.valueNumeric} ${a.valueCurrency ?? '(валюта не указана)'}`}
          {a.taxBasis && ` · ${a.taxBasis === 'with_vat' ? 'с НДС' : 'без НДС'}`}
        </p>
      )}
      {a.needsRevalidation && (
        <p className={styles.warn}>Набор доказательств изменился после последнего решения — нужен пересмотр.</p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <div className={styles.columns}>
        <section>
          <h4>{STANCE_LABELS.supports} ({grouped.supports.length})</h4>
          <ul className={styles.evidenceList}>{renderEvidence(grouped.supports)}</ul>
        </section>
        <section>
          <h4>{STANCE_LABELS.contradicts} ({grouped.contradicts.length})</h4>
          {grouped.contradicts.length === 0 ? (
            <p className={styles.muted}>Опровержений в собранных источниках не найдено.</p>
          ) : (
            <ul className={styles.evidenceList}>{renderEvidence(grouped.contradicts)}</ul>
          )}
        </section>
      </div>
      {grouped.mentions.length > 0 && (
        <section>
          <h4>{STANCE_LABELS.mentions} ({grouped.mentions.length})</h4>
          <ul className={styles.evidenceList}>{renderEvidence(grouped.mentions)}</ul>
        </section>
      )}

      <form className={styles.form} onSubmit={submit}>
        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>Решение</span>
            <select value={decision} onChange={e => setDecision(e.target.value as AssertionStatus)}>
              {DECISIONS.map(d => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Что именно проверено</span>
            <select value={scope} onChange={e => setScope(e.target.value as 'reflects_source' | 'fact_confirmed')}>
              <option value="reflects_source">{REVIEW_SCOPE_LABELS.reflects_source}</option>
              <option value="fact_confirmed">{REVIEW_SCOPE_LABELS.fact_confirmed}</option>
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span>{reasonRequired ? 'Причина (обязательна для этого решения)' : 'Причина'}</span>
          <textarea rows={2} value={reason} required={reasonRequired} minLength={reasonRequired ? 3 : undefined} onChange={e => setReason(e.target.value)} />
        </label>
        <button type="submit" className={styles.primary} disabled={review.isPending || (reasonRequired && reason.trim().length < 3)}>
          {review.isPending ? 'Записываю…' : 'Записать решение'}
        </button>
      </form>

      <section>
        <h4>История решений ({reviews.length})</h4>
        {reviews.length === 0 ? (
          <p className={styles.muted}>Решений ещё не было.</p>
        ) : (
          <ul className={styles.reviews}>
            {reviews.map(r => (
              <li key={r.id}>
                <strong>{ASSERTION_STATUS_LABELS[r.decision]}</strong> · {REVIEW_SCOPE_LABELS[r.scope]} · {r.reviewer} ·{' '}
                {formatDateTime(r.decidedAt)} · версия {r.assertionVersion}
                {r.provenanceGap && <span className={styles.warn}> · обоснование не сохранилось</span>}
                {r.reason && <div className={styles.muted}>{r.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
