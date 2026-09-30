// Разбор одного неясного упоминания (этап 15A): цитата, варианты с реквизитами, почему неясно,
// история решений. Решение относится только к этому упоминанию в этом тексте; объединить
// одноимённые карточки — во вкладке «Дубли», после сравнения.

import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import type { AmbiguityDecisionKind, IAmbiguityDetail } from '../api/types';
import { newKey } from '../lib/idempotency';
import { AMBIGUITY_DECISION_LABELS, AMBIGUITY_STATUS_LABELS, formatDateTime } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { formatCountWord } from '../lib/format';
import { AMBIGUITY_STATUS_TONE, toneOf } from '../lib/statusTone';
import { AmbiguityCandidates } from './admin/AmbiguityCandidates';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Cluster } from './ui/Cluster';
import { Field } from './ui/Field';
import { Loading } from './ui/Loading';
import { Stack } from './ui/Stack';
import { Textarea } from './ui/Textarea';
import { useToast } from './ui/toast';
import styles from './admin/Ambiguity.module.css';

export interface IAmbiguityChoice {
  decision: AmbiguityDecisionKind;
  entityId: number | null;
}

export const AmbiguityDetail: FC<{ ambiguityId: number }> = ({ ambiguityId }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [choice, setChoice] = useState<IAmbiguityChoice | null>(null);
  const [reason, setReason] = useState('');
  // Один ключ на открытую форму: повторное нажатие не создаёт второе решение.
  const [key, setKey] = useState(() => newKey('ambiguity'));
  const [error, setError] = useState<string | null>(null);

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
      toast.show({ tone: 'success', text: result.replayed ? 'Это решение уже было записано.' : 'Решение записано.' });
      setChoice(null);
      setReason('');
      setKey(newKey('ambiguity'));
      void queryClient.invalidateQueries({ queryKey: ['ambiguity', ambiguityId] });
      void queryClient.invalidateQueries({ queryKey: ['ambiguities'] });
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        setError('Упоминание изменилось (новые варианты или чужое решение). Решение не записано — данные обновлены, решите заново.');
        void detail.refetch();
      } else if (err instanceof ApiError && err.code === 'choice_blocked') {
        setError(`Этот выбор сервер не принял: ${err.message}`);
      } else {
        setError(describeLoadError(err));
      }
    },
  });

  if (detail.isLoading) return <Loading label="Загружаю упоминание…" />;
  if (detail.isError || !detail.data) {
    return (
      <Callout tone="danger" title="Упоминание не загрузилось" action={<Button onClick={() => void detail.refetch()}>Повторить</Button>}>
        {describeLoadError(detail.error)}
      </Callout>
    );
  }
  const d = detail.data;
  const open = d.status === 'open';
  const nameOf = (id: number | null): string | null => (id === null ? null : (d.candidates.find(c => c.id === id)?.name ?? null));
  const chosenLabel = choice
    ? `${AMBIGUITY_DECISION_LABELS[choice.decision] ?? choice.decision}${choice.entityId !== null ? `: ${nameOf(choice.entityId) ?? 'выбранный вариант'}` : ''}`
    : '';

  return (
    <Stack gap={4} className={styles.detail}>
      <Cluster gap={2}>
        <Badge tone={toneOf(AMBIGUITY_STATUS_TONE, d.status)}>{AMBIGUITY_STATUS_LABELS[d.status] ?? d.status}</Badge>
        <span className={styles.muted}>встречается {formatCountWord(d.occurrences, ['раз', 'раза', 'раз'])}</span>
      </Cluster>

      {d.revision ? (
        <figure className={styles.figure}>
          <blockquote className={styles.quote}>
            {d.revision.excerpt ?? 'Точной цитаты нет: упоминание не найдено в тексте дословно.'}
          </blockquote>
          {d.revision.publishedAt && (
            <figcaption className={styles.muted}>опубликовано {formatDateTime(d.revision.publishedAt)}</figcaption>
          )}
        </figure>
      ) : (
        <Callout tone="neutral">Текст не сохранён — выбор ни на что не повлияет.</Callout>
      )}
      <p className={styles.text}>
        <span className={styles.label}>Почему неясно:</span> {d.whyAmbiguous}
      </p>

      <AmbiguityCandidates
        entityKind={d.entityKind}
        candidates={d.candidates}
        open={open}
        choice={choice}
        onChoose={entityId => setChoice({ decision: 'resolved_to', entityId })}
      />
      {/* Пояснения к выбору у всех вариантов общие: печатаем один раз. */}
      {d.candidates[0]?.choice.notes.map(n => (
        <p key={n} className={styles.note}>
          {n}
        </p>
      ))}

      {open && (
        <Stack gap={3}>
          <Cluster gap={2}>
            <Button
              aria-pressed={choice?.decision === 'kept_unknown'}
              onClick={() => setChoice({ decision: 'kept_unknown', entityId: null })}
            >
              Не ясно
            </Button>
            <Button aria-pressed={choice?.decision === 'dismissed'} onClick={() => setChoice({ decision: 'dismissed', entityId: null })}>
              {d.entityKind === 'company' ? 'Это не компания' : 'Это не объект'}
            </Button>
          </Cluster>
          {choice && (
            <Field label={`Причина решения «${chosenLabel}»`} hint="Обязательно: по ней решение потом перепроверяют." required>
              {control => <Textarea {...control} rows={2} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} />}
            </Field>
          )}
          <p className={styles.note}>
            Выбор компании относится только к этому тексту и не подтверждает участие, договор или долг. Если это одна и та же компания под
            разными карточками — объедините их во вкладке <Link to="/admin/review?tab=duplicates">«Дубли»</Link>.
          </p>
          {error && <Callout tone="danger">{error}</Callout>}
          <div>
            <Button
              variant="primary"
              loading={decide.isPending}
              disabled={!choice || reason.trim().length < 3}
              onClick={() => {
                setError(null);
                decide.mutate({ version: d.version });
              }}
            >
              Записать решение
            </Button>
          </div>
        </Stack>
      )}

      {d.decisions.length > 0 && (
        <Stack gap={2}>
          <span className={styles.label}>История решений</span>
          <ul className={styles.history}>
            {d.decisions.map(x => (
              <li key={x.id}>
                {AMBIGUITY_DECISION_LABELS[x.decision] ?? x.decision}
                {x.entityId !== null ? `: ${nameOf(x.entityId) ?? 'вариант, которого больше нет в списке'}` : ''} · {x.actor} ·{' '}
                {formatDateTime(x.decidedAt)}
                <span className={styles.muted}>{x.reason}</span>
              </li>
            ))}
          </ul>
        </Stack>
      )}
    </Stack>
  );
};
