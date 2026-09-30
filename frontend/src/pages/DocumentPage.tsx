// Публикация отдельной страницей — только сам пост, в том же виде, что и в списках.
//
// Служебный разбор («что портал взял из текста») и таблица версий сняты решением владельца
// 23.09.2026: оператор приходит прочитать новость. Разбор и версии остались в API
// (`/api/items/:id/extraction`, `/api/items/:id/revisions`) и в CLI, данные целы.
//
// Одна новость в нескольких каналах — несколько публикаций, а не несколько подтверждений:
// выбранный канал — в адресе (?source=), пост — по ширине чтения и по центру экрана.

import { FC, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { ApiError, api } from '../api/client';
import type { ISourceItem } from '../api/types';
import { TelegramPost } from '../components/TelegramPost';
import { Button } from '../components/ui/Button';
import { ButtonLink } from '../components/ui/ButtonLink';
import { Callout } from '../components/ui/Callout';
import { EmptyState } from '../components/ui/EmptyState';
import { Loading } from '../components/ui/Loading';
import { PageHeader } from '../components/ui/PageHeader';
import { Skeleton } from '../components/ui/Skeleton';
import { numberParam, useUrlState } from '../hooks/useUrlState';
import { describeLoadError } from '../lib/loadError';
import { SourceSwitcher } from './document/SourceSwitcher';
import styles from './DocumentPage.module.css';

const toPublications = (
  <ButtonLink to="/?view=publications" variant="primary">
    К публикациям
  </ButtonLink>
);

export const DocumentPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const documentId = Number(id);
  const valid = Number.isSafeInteger(documentId) && documentId > 0;
  const [source, setSource] = useUrlState('source', numberParam(null));

  const itemsQuery = useQuery({
    queryKey: ['document', documentId, 'items'],
    queryFn: () => api.get<{ items: ISourceItem[] }>(`/api/documents/${documentId}/items`),
    enabled: valid,
  });

  const items = itemsQuery.data?.items ?? [];
  // Неизвестный канал в адресе — первая перепечатка, а не пустая страница.
  const current = items.find(i => i.id === source) ?? items[0] ?? null;
  const missing = !valid || (itemsQuery.error instanceof ApiError && itemsQuery.error.status === 404);

  let body: ReactNode;
  if (missing) {
    body = (
      <EmptyState title="Публикация не найдена" action={toPublications}>
        {valid ? 'Возможно, адрес устарел.' : 'В адресе нет номера публикации.'}
      </EmptyState>
    );
  } else if (itemsQuery.isError) {
    body = (
      <Callout tone="danger" title="Публикация не загрузилась" action={<Button onClick={() => void itemsQuery.refetch()}>Повторить</Button>}>
        {describeLoadError(itemsQuery.error)}
      </Callout>
    );
  } else if (itemsQuery.isLoading) {
    body = (
      <Loading label="Загружаю публикацию…">
        <div className={styles.reader}>
          <Skeleton height="320px" radius="md" />
        </div>
      </Loading>
    );
  } else if (!current) {
    body = (
      <EmptyState title="Текста этой публикации нет" action={toPublications}>
        Текст не сохранён — откройте оригинал.
      </EmptyState>
    );
  } else {
    body = (
      <div className={items.length > 1 ? styles.layout : styles.single}>
        {items.length > 1 && <SourceSwitcher items={items} current={current} onSelect={setSource} />}
        <div className={styles.reader}>
          <TelegramPost
            key={current.id}
            revisionId={current.latestRevisionId}
            sourceTitle={current.sourceTitle}
            sourceKey={current.sourceKey}
            sourceKind={current.sourceKind}
            publishedAt={current.publishedAt}
            observedAt={current.firstObservedAt}
            url={current.originalUrl ?? current.canonicalUrl}
            title={current.title}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Роль заголовка на экране играет сам пост; h1 — для диктора и вкладки браузера. */}
      <PageHeader title={current?.title ?? current?.topic ?? 'Публикация'} titleHidden />
      {body}
    </div>
  );
};
