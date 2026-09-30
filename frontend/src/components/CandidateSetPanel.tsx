// Что найденное в тексте дало карточкам — только чтение.
//
// Оператор ничего не переносит: разобранное уходит в карточки само после полного разбора.
// Здесь видно, что именно туда попало, что убрано прежним разбором и что не попало вовсе.
// Найденное — это сказанное в тексте, а не проверенные факты.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IPublishPreview, IPublishPreviewItem } from '../api/types';
import { formatCount, pluralize } from '../lib/format';
import { CANDIDATE_SET_STATUS_LABELS, PREDICATE_LABELS } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { CANDIDATE_SET_STATUS_TONE, toneOf } from '../lib/statusTone';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ButtonLink } from './ui/ButtonLink';
import { Callout } from './ui/Callout';
import { Cluster } from './ui/Cluster';
import { Disclosure } from './ui/Disclosure';
import { Loading } from './ui/Loading';
import { Stack } from './ui/Stack';
import styles from './admin/Found.module.css';

/** Список найденного одного вида: вид сведения и цитаты, без внутренних подписей. */
const items = (title: string, list: IPublishPreviewItem[]) =>
  list.length === 0 ? null : (
    <Disclosure summary={title} meta={formatCount(list.length)}>
      <ul className={styles.list}>
        {list.map(i => (
          <li key={i.signature} className={styles.item}>
            <span className={styles.kind}>{PREDICATE_LABELS[i.predicate] ?? i.predicate}</span>
            {i.quotes.length === 0 ? (
              <span className={styles.muted}>цитаты в тексте нет</span>
            ) : (
              i.quotes.map(q => (
                <blockquote key={q} className={styles.quote}>
                  {q}
                </blockquote>
              ))
            )}
          </li>
        ))}
      </ul>
    </Disclosure>
  );

export const CandidateSetPanel: FC<{ setId: number }> = ({ setId }) => {
  const preview = useQuery({
    queryKey: ['candidate-set', setId],
    queryFn: () => api.get<IPublishPreview>(`/api/reprocess/sets/${setId}/preview`),
  });

  if (preview.isLoading) return <Loading label="Загружаю найденное…" />;
  if (preview.isError || !preview.data) {
    return (
      <Callout tone="danger" title="Найденное не загрузилось" action={<Button onClick={() => void preview.refetch()}>Повторить</Button>}>
        {describeLoadError(preview.error)}
      </Callout>
    );
  }
  const p = preview.data;

  return (
    <Stack gap={3}>
      <Cluster gap={2}>
        <span className={styles.muted}>Найденное в тексте:</span>
        <Badge tone={toneOf(CANDIDATE_SET_STATUS_TONE, p.status)}>{CANDIDATE_SET_STATUS_LABELS[p.status] ?? p.status}</Badge>
      </Cluster>
      {!p.run.complete && (
        <Callout tone="warning">Текст разобран не полностью — в карточки не попадёт; портал повторит разбор сам.</Callout>
      )}
      {!p.policy.allowed && (
        <Callout tone="neutral">
          Источник выключен{p.policy.reason ? `: ${p.policy.reason}` : ''}. Найденное перенесётся после его включения.
        </Callout>
      )}
      {p.stale.stale && (
        <Callout tone="info">
          Текст изменился после разбора{p.stale.reason ? `: ${p.stale.reason}` : ''}. Портал разберёт новую версию сам.
        </Callout>
      )}
      {!p.relevant && <p className={styles.muted}>Текст признан не относящимся к стройке.</p>}

      <div>
        {items('Перенесено в карточки', p.added)}
        {items('Убрано из карточек', p.removed)}
        {items('Осталось как было', p.kept)}
        {items('Не перенесено: нет цитаты или нужна проверка', p.ungrounded)}
        {p.changed.length > 0 && (
          <Disclosure summary="Изменились подробности" meta={formatCount(p.changed.length)}>
            <ul className={styles.list}>
              {p.changed.map(c => (
                <li key={c.before + c.after} className={styles.item}>
                  <span className={styles.muted}>было: {c.before}</span>
                  <span>стало: {c.after}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </div>

      {p.reviewImpact.length > 0 && (
        <Callout
          tone="warning"
          action={
            <ButtonLink to="/admin/review?tab=conflicts" variant="link" size="sm">
              Открыть «Проверку»
            </ButtonLink>
          }
        >
          {formatCount(p.reviewImpact.length)}{' '}
          {pluralize(p.reviewImpact.length, ['сведение потеряло', 'сведения потеряли', 'сведений потеряли'])} эту цитату — решения оператора
          остались, но их стоит перепроверить.
        </Callout>
      )}
      {p.contradictions.length > 0 && (
        <Callout
          tone="info"
          action={
            <ButtonLink to="/admin/review?tab=conflicts" variant="link" size="sm">
              Противоречия в «Проверке»
            </ButtonLink>
          }
        >
          Другие источники это опровергают ({formatCount(p.contradictions.length)}).
        </Callout>
      )}
      <p className={styles.muted}>Это то, что модель нашла в тексте, а не проверенные факты.</p>
    </Stack>
  );
};
