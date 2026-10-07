// Разбор одного неясного упоминания (этап 15A): цитата, варианты с реквизитами, почему неясно,
// история решений. Решение — «Да» у варианта или «Нет, ни один» (решение владельца 06.10.2026:
// без причины и без отдельной кнопки записи). Относится только к этому упоминанию в этом тексте;
// объединить одноимённые карточки — во вкладке «Дубли».

import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import type { AmbiguityDecisionKind, IAmbiguityDetail } from '../api/types';
import { newKey } from '../lib/idempotency';
import { AMBIGUITY_DECISION_LABELS, AMBIGUITY_STATUS_LABELS, actorLabel, formatDateTime } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { formatCountWord } from '../lib/format';
import { AMBIGUITY_STATUS_TONE, toneOf } from '../lib/statusTone';
import { AmbiguityCandidates } from './admin/AmbiguityCandidates';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Cluster } from './ui/Cluster';
import { Loading } from './ui/Loading';
import { Stack } from './ui/Stack';
import { useToast } from './ui/toast';
import styles from './admin/Ambiguity.module.css';

export interface IAmbiguityChoice {
  decision: AmbiguityDecisionKind;
  entityId: number | null;
}

export const AmbiguityDetail: FC<{ ambiguityId: number }> = ({ ambiguityId }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Один ключ на открытую форму: повторное нажатие не создаёт второе решение.
  const [key, setKey] = useState(() => newKey('ambiguity'));
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['ambiguity', ambiguityId],
    queryFn: () => api.get<IAmbiguityDetail>(`/api/entities/ambiguities/${ambiguityId}`),
    refetchOnWindowFocus: false,
  });

  const decide = useMutation({
    mutationFn: (input: IAmbiguityChoice & { version: number }) =>
      api.post<{ decisionId: number; replayed: boolean; version: number }>(`/api/entities/ambiguities/${ambiguityId}/decisions`, {
        decision: input.decision,
        entityId: input.entityId,
        expectedVersion: input.version,
        idempotencyKey: key,
      }),
    onSuccess: result => {
      toast.show({ tone: 'success', text: result.replayed ? 'Это решение уже было записано.' : 'Решение записано.' });
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
  const choose = (next: IAmbiguityChoice): void => {
    setError(null);
    decide.mutate({ ...next, version: d.version });
  };
  const pending = decide.isPending ? (decide.variables ?? null) : null;

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

      {open && (
        <p className={styles.text}>
          <span className={styles.label}>{d.entityKind === 'company' ? 'Это одна из этих компаний?' : 'Это один из этих объектов?'}</span>
        </p>
      )}
      <AmbiguityCandidates
        entityKind={d.entityKind}
        candidates={d.candidates}
        open={open}
        pending={pending}
        onChoose={entityId => choose({ decision: 'resolved_to', entityId })}
      />
      {/* Пояснения к выбору у всех вариантов общие: печатаем один раз. */}
      {d.candidates[0]?.choice.notes.map(n => (
        <p key={n} className={styles.note}>
          {n}
        </p>
      ))}

      {open && (
        <Stack gap={3}>
          <div>
            <Button
              loading={pending?.decision === 'kept_unknown'}
              disabled={pending !== null}
              onClick={() => choose({ decision: 'kept_unknown', entityId: null })}
            >
              {d.entityKind === 'company' ? 'Нет, ни одна' : 'Нет, ни один'}
            </Button>
          </div>
          <p className={styles.note}>
            Выбор относится только к этому тексту и не подтверждает участие, договор или долг. Если это одна и та же компания под разными
            карточками — объедините их во вкладке <Link to="/admin/review?tab=duplicates">«Дубли»</Link>.
          </p>
          {error && <Callout tone="danger">{error}</Callout>}
        </Stack>
      )}

      {d.decisions.length > 0 && (
        <Stack gap={2}>
          <span className={styles.label}>История решений</span>
          <ul className={styles.history}>
            {d.decisions.map(x => (
              <li key={x.id}>
                {AMBIGUITY_DECISION_LABELS[x.decision] ?? x.decision}
                {x.entityId !== null ? `: ${nameOf(x.entityId) ?? 'вариант, которого больше нет в списке'}` : ''} · {actorLabel(x.actor)} ·{' '}
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
