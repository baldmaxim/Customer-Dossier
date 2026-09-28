// Лента публикаций о компании: что писали и что из этого взято в карточку.
//
// Прежний блок «Упоминания» читал legacy-таблицу `mentions`, которую новый конвейер
// не наполняет вовсе, — на свежих данных он был пуст всегда. Здесь источник тот же,
// что у самой карточки: публикации и опубликованные утверждения.
//
// Строка — публикация, а не факт: статья с тремя фактами остаётся одной строкой.
// Тема от модели подписана как машинная (headline@1) и заголовок источника не подменяет.

import { FC } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { IPublicationFact, IPublicationRow } from '../api/types';
import {
  AMOUNT_PURPOSE_LABELS,
  ASSERTION_ROLE_LABELS,
  EVENT_LABELS,
  MODALITY_LABELS,
  formatDate,
  formatDateTime,
  formatMoney,
} from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { EmptyState, Section } from './ui/Section';
import styles from './CompanyFeed.module.css';

/** Что сказано — одной строкой. Слова берутся из словарей, машинные ключи на экран не попадают. */
const factText = (fact: IPublicationFact, companyName: string): string => {
  const where = fact.projectName ? ` · ${fact.projectName}` : '';
  const other = fact.otherCompanyName ? ` · ${fact.otherCompanyName}` : '';
  const money =
    fact.amount !== null
      ? ` · ${formatMoney(Number(fact.amount))}${fact.valueType ? ` (${AMOUNT_PURPOSE_LABELS[fact.valueType] ?? fact.valueType})` : ''}`
      : '';

  if (fact.predicate === 'participates_in_project') {
    const role = fact.role ? (ASSERTION_ROLE_LABELS[fact.role] ?? fact.role) : 'роль не названа';
    return `${companyName} — ${role}${where}${money}`;
  }
  if (fact.predicate === 'contract') {
    const kind = fact.role ? (ASSERTION_ROLE_LABELS[fact.role] ?? fact.role) : 'договор';
    return `${kind}${other}${where}${money}`;
  }
  if (fact.predicate === 'corporate_relation') {
    const kind = fact.role ? (ASSERTION_ROLE_LABELS[fact.role] ?? fact.role) : 'корпоративная связь';
    return `${kind}${other}`;
  }
  if (fact.predicate === 'event') {
    const type = fact.eventType ? (EVENT_LABELS[fact.eventType] ?? fact.eventType) : 'событие';
    return `${type}${other}${where}${money}`;
  }
  return `упоминание${where}`;
};

const FactLine: FC<{ fact: IPublicationFact; companyName: string }> = ({ fact, companyName }) => {
  // Отрицание и неуверенность видны словом: «сообщается, что не является подрядчиком»
  // и «является подрядчиком» — разные сведения, и по цвету их различать нельзя.
  const negated = fact.polarity === 'negative';
  const modality = fact.modality && fact.modality !== 'reported_fact' ? MODALITY_LABELS[fact.modality] : null;

  return (
    <li className={styles.fact}>
      <span className={styles.factText}>
        {negated && <span className={styles.negated}>отрицается: </span>}
        {factText(fact, companyName)}
      </span>
      {modality && (
        <Badge className={styles.factBadge} hint="как об этом сказано в тексте: факт, заявление, план или слух">
          {modality}
        </Badge>
      )}
      {fact.quote && (
        <span className={styles.quote} title="цитата подтверждает, что так написано в источнике, а не что это правда">
          «{fact.quote}»
        </span>
      )}
    </li>
  );
};

export const CompanyFeed: FC<{ companyId: number; companyName: string }> = ({ companyId, companyName }) => {
  const feed = useInfiniteQuery({
    queryKey: ['company', companyId, 'publications'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '15' });
      if (pageParam) params.set('cursor', pageParam);
      return api.get<{ items: IPublicationRow[]; nextCursor: string | null }>(
        `/api/companies/${companyId}/publications?${params}`,
      );
    },
    getNextPageParam: last => last.nextCursor,
  });

  const items = feed.data?.pages.flatMap(p => p.items) ?? [];

  return (
    <Section title="Последние публикации" note="по дате источника; без неё — по моменту наблюдения">
      {feed.isError && <p role="alert">{describeLoadError(feed.error)}</p>}
      {feed.isLoading && <p className={styles.muted}>Загрузка…</p>}
      {feed.isSuccess && items.length === 0 && (
        <EmptyState>
          Публикаций об этой компании в выборке нет. Это значит только то, что в собранных источниках
          её не нашли, — а не то, что о ней не писали.
        </EmptyState>
      )}

      <ol className={styles.list}>
        {items.map(item => (
          <li key={item.itemId} className={styles.item}>
            <div className={styles.head}>
              {item.documentId !== null ? (
                <Link className={styles.title} to={`/documents/${item.documentId}`}>
                  {item.title ?? item.topic ?? 'без заголовка'}
                </Link>
              ) : (
                <span className={styles.title}>{item.title ?? item.topic ?? 'без заголовка'}</span>
              )}
              {item.title === null && item.topic !== null && (
                <Badge hint="у публикации нет заголовка: тему составила локальная модель по началу текста. Это подпись строки, а не заголовок источника и не доказательство">
                  тема от модели
                </Badge>
              )}
            </div>

            <div className={styles.meta}>
              <span>
                {item.publishedAt !== null
                  ? formatDate(item.publishedAt)
                  : `${formatDateTime(item.observedAt)} — момент наблюдения, дата публикации неизвестна`}
              </span>
              <span className={styles.source}>{item.sourceTitle}</span>
              {item.url && (
                <a href={item.url} target="_blank" rel="noreferrer noopener">
                  оригинал
                </a>
              )}
            </div>

            {item.facts.length === 0 ? (
              <p className={styles.snippet}>{item.snippet}…</p>
            ) : (
              <ul className={styles.facts}>
                {item.facts.map((fact, i) => (
                  <FactLine key={fact.assertionId ?? `legacy-${i}`} fact={fact} companyName={companyName} />
                ))}
                {item.moreFacts > 0 && (
                  <li className={styles.more}>
                    и ещё {item.moreFacts} —{' '}
                    {item.documentId !== null ? (
                      <Link to={`/documents/${item.documentId}`}>на странице публикации</Link>
                    ) : (
                      'на странице публикации'
                    )}
                  </li>
                )}
              </ul>
            )}
          </li>
        ))}
      </ol>

      {feed.hasNextPage && (
        <Button variant="ghost" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
          {feed.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
        </Button>
      )}
    </Section>
  );
};
