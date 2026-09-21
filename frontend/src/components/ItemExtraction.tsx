import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { IItemAssertion, IItemOutcome } from '../api/types';
import {
  ASSERTION_ROLE_LABELS,
  EVENT_LABELS,
  ITEM_STATE_HINTS,
  ITEM_STATE_LABELS,
  MODALITY_LABELS,
  PREDICATE_HINTS,
  PREDICATE_LABELS,
  formatDate,
  formatDateTime,
} from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { Badge } from './ui/Badge';
import { EmptyState, Section } from './ui/Section';
import { Term } from './ui/Hint';
import styles from './ItemExtraction.module.css';

/** Заголовок утверждения: вид, роль или событие — без машинных ключей на экране. */
const headline = (a: IItemAssertion): string => {
  if (a.predicate === 'event') return EVENT_LABELS[a.eventType ?? ''] ?? a.eventType ?? 'событие';
  if (a.role) return ASSERTION_ROLE_LABELS[a.role] ?? a.role;
  return PREDICATE_LABELS[a.predicate] ?? a.predicate;
};

/**
 * Что портал взял из текста: компании и объекты ссылками, утверждения с цитатами.
 *
 * Пусто здесь всегда с причиной. «Текст не о стройке» и «разбора не было» — разные
 * положения дел, и экран не должен выдавать одно за другое. Цитата подтверждает, что
 * так написано в источнике, а не что это правда.
 */
export const ItemExtraction: FC<{ itemId: number }> = ({ itemId }) => {
  const outcome = useQuery({
    queryKey: ['item', itemId, 'extraction'],
    queryFn: () => api.get<IItemOutcome>(`/api/items/${itemId}/extraction`),
  });

  if (outcome.isLoading) return <p className={styles.muted}>Загрузка…</p>;
  if (outcome.isError || !outcome.data) {
    return (
      <p className={styles.muted} role="alert">
        {describeLoadError(outcome.error)}
      </p>
    );
  }
  const o = outcome.data;
  const empty = o.assertions.length === 0;

  return (
    <Section title="Что портал взял из этого текста">
      <p className={styles.state}>
        <Term value={o.state} labels={ITEM_STATE_LABELS} hints={ITEM_STATE_HINTS} />
        {o.run && (
          <span className={styles.muted}>
            {' · '}редакция №{o.run.revisionNo}
            {o.run.finishedAt !== null && ` · ${formatDateTime(o.run.finishedAt)}`}
            {o.run.totalChars !== null && ` · покрыто ${o.run.coveredChars ?? 0} из ${o.run.totalChars} символов`}
          </span>
        )}
      </p>
      {o.run?.error && <p className={styles.warn}>{o.run.error}</p>}
      {!o.policy.allowed && o.policy.reason && <p className={styles.warn}>Допуск источника: {o.policy.reason}</p>}

      {empty ? (
        <EmptyState>
          Из этого текста в карточки не взято ничего. Это не значит, что в нём нет смысла: портал
          извлекает только связи компаний, объектов и событий — и только те, что подтверждаются
          дословной цитатой.
        </EmptyState>
      ) : (
        <>
          {(o.companies.length > 0 || o.projects.length > 0) && (
            <p className={styles.entities}>
              {o.companies.map(c => (
                <Link key={`c-${c.id}`} className={styles.entity} to={`/company/${c.id}`}>
                  {c.name}
                </Link>
              ))}
              {o.projects.map(p => (
                <Link key={`p-${p.id}`} className={styles.entity} to={`/projects/${p.id}`}>
                  {p.name}
                </Link>
              ))}
            </p>
          )}

          <ul className={styles.list}>
            {o.assertions.map(a => (
              <li key={a.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <strong>{headline(a)}</strong>
                  <Badge hint={PREDICATE_HINTS[a.predicate]}>
                    {PREDICATE_LABELS[a.predicate] ?? a.predicate}
                  </Badge>
                  {a.polarity === 'negative' && <Badge tone="warn">источник это отрицает</Badge>}
                  {a.modality !== 'reported_fact' && (
                    <Badge tone="warn">
                      <Term value={a.modality} labels={MODALITY_LABELS} />
                    </Badge>
                  )}
                  {a.validFrom !== null && <span className={styles.muted}>{formatDate(a.validFrom)}</span>}
                </div>
                <p className={styles.parties}>
                  {a.parties.map(p => (
                    <Link key={`${p.kind}-${p.side}-${p.id}`} to={p.kind === 'company' ? `/company/${p.id}` : `/projects/${p.id}`}>
                      {p.name}
                    </Link>
                  ))}
                </p>
                {a.quotes.map(q => (
                  <blockquote key={`${q.spanStart}-${q.spanEnd}-${q.stance}`} className={styles.quote}>
                    {q.quote}
                    <span className={styles.muted}>
                      {' '}
                      — символы {q.spanStart}–{q.spanEnd}
                      {q.stance === 'contradicts' ? ', опровергает' : ''}
                    </span>
                  </blockquote>
                ))}
              </li>
            ))}
          </ul>
          <p className={styles.muted}>
            Цитата подтверждает, что так написано в источнике, а не то, что это правда.
          </p>
        </>
      )}
    </Section>
  );
};
